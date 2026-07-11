(function(global){
  'use strict';

  const U = global.OmniUtils;

  function metrics(cache){
    const alive = name => (cache[name] || []).filter(x => x.deleted !== true);
    const vendors = alive('vendors');
    const orders = alive('orders');
    const users = alive('users');
    const credit = alive('creditAccounts');
    const shifts = alive('employeeShifts');
    const today = U.todayKey();
    const todaysOrders = orders.filter(o => U.todayKey(Number(o.createdAt || 0)) === today);
    const revenue = todaysOrders.filter(o => o.status !== 'cancelled').reduce((sum,o)=>sum+Number(o.total||0),0);
    const outstanding = credit.reduce((sum,c)=>sum+Number(c.balance||0),0);
    return {
      vendors,
      orders,
      users,
      credit,
      shifts,
      cards: [
        ['Vendors', vendors.length, {text:`${vendors.filter(v=>v.status==='pending').length} pending`, cls:'warn'}],
        ['Users', users.length, {text:'role based', cls:'ok'}],
        ['Orders today', todaysOrders.length, {text:U.money(revenue), cls:'ok'}],
        ['Credit outstanding', U.money(outstanding), {text:`${credit.filter(c=>c.status==='pending').length} requests`, cls:'warn'}]
      ],
      insights: [
        outstanding > 0 ? `Outstanding credit is ${U.money(outstanding)} across ${credit.length} account(s).` : 'No outstanding credit yet.',
        vendors.some(v=>v.status==='pending') ? 'There are pending vendors waiting for approval.' : 'No pending vendor approvals.',
        shifts.some(s=>s.status==='open') ? 'At least one employee is currently checked in.' : 'No open attendance shifts right now.'
      ]
    };
  }

  global.SuperAnalytics = { metrics };
})(window);

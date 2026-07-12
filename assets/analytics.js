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
    const dailyOrders = Array.from({length:7}, (_, index) => {
      const date = new Date();
      date.setHours(0,0,0,0);
      date.setDate(date.getDate() - (6 - index));
      const key = U.todayKey(date.getTime());
      const list = orders.filter(order => U.todayKey(Number(order.createdAt || 0)) === key);
      return {key, label:date.toLocaleDateString(undefined,{weekday:'short'}), count:list.length, revenue:list.filter(order=>order.status!=='cancelled').reduce((sum,order)=>sum+Number(order.total||0),0)};
    });
    const statusCounts = ['pending','accepted','preparing','done','cancelled'].map(status => ({status, count:orders.filter(order => order.status === status).length}));
    return {
      vendors,
      orders,
      users,
      credit,
      shifts,
      dailyOrders,
      statusCounts,
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

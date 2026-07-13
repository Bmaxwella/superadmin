(function(global){
  'use strict';

  const U = global.OmniUtils;
  const DB = global.OmniDB;
  const UI = global.SuperUI;
  const collections = global.OmniConfig.collections;
  const state = DB.state.cache;
  let renderTimer = null;
  let currentAdmin = null;
  let presenceTimer = null;
  let liveUnsubscribers = [];
  const pendingRenders = new Set();

  function rows(name){ return (state[name] || []).filter(row => row.deleted !== true); }
  function adminId(){ return currentAdmin?.id || currentAdmin?.userId || ''; }
  function adminMeta(record={}){
    const userId = adminId();
    if(!userId) throw new Error('SuperAdmin authentication is required.');
    return {userId, vendorId:record.vendorId || ''};
  }
  function appReady(){ return !!document.querySelector('.content .view'); }
  function activeField(){
    const el = document.activeElement;
    return el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) ? el : null;
  }
  function isEditingField(){
    const el = activeField();
    return !!el && el.id !== 'globalSearch';
  }
  function viewUsesCollection(collection){
    const view = UI.activeView();
    const dependencies = {
      dashboard: new Set(['vendors','users','orders','creditAccounts','employeeShifts','presence']),
      vendors: new Set(['vendors','publicVendors','products']),
      users: new Set(['users','presence']),
      orders: new Set(['orders']),
      credit: new Set(['creditAccounts']),
      attendance: new Set(['employeeShifts']),
      events: new Set(['events'])
    };
    return collection === 'search' || collection === 'deferred' || view === 'database' || dependencies[view]?.has(collection);
  }
  function flushPendingRender(){
    if(!pendingRenders.size || isEditingField()) return;
    pendingRenders.clear();
    scheduleRender('deferred');
  }
  function captureViewFields(view){
    const container = document.getElementById(view);
    if(!container) return [];
    return [...container.querySelectorAll('input[id],select[id],textarea[id]')].map(field => ({id:field.id, value:field.value, checked:field.checked}));
  }
  function restoreViewFields(fields){
    fields.forEach(saved => {
      const field = document.getElementById(saved.id);
      if(!field) return;
      field.value = saved.value;
      if(field.type === 'checkbox' || field.type === 'radio') field.checked = saved.checked;
    });
  }
  function searchRows(list){
    const query = (document.getElementById('globalSearch')?.value || '').trim().toLowerCase();
    if(!query) return list;
    return list.filter(row => JSON.stringify(row).toLowerCase().includes(query));
  }
  function publicVendorPayload(vendor, overrides={}){
    return {...vendor, ...overrides, id:vendor.id, products:'[]', updatedAt:Date.now()};
  }

  function renderDashboard(){
    const m = global.SuperAnalytics.metrics(state);
    const dailyMax = Math.max(1, ...m.dailyOrders.map(day => day.count));
    const statusMax = Math.max(1, ...m.statusCounts.map(item => item.count));
    document.getElementById('dashboard').innerHTML = `
      <div class="grid cols-4">${m.cards.map(c=>UI.stat(c[0],c[1],c[2])).join('')}</div>
      <div class="grid cols-2">
        <div class="card pad"><div class="head"><h2>Orders · Last 7 Days</h2></div><div class="bar-chart">${m.dailyOrders.map(day=>`<div class="bar-row"><span>${U.esc(day.label)}</span><div class="bar-track"><i style="width:${Math.max(3,day.count/dailyMax*100)}%"></i></div><b>${day.count}</b><small>${U.money(day.revenue)}</small></div>`).join('')}</div></div>
        <div class="card pad"><div class="head"><h2>Order Status</h2></div><div class="bar-chart status-chart">${m.statusCounts.map(item=>`<div class="bar-row"><span>${U.esc(item.status)}</span><div class="bar-track"><i style="width:${Math.max(3,item.count/statusMax*100)}%"></i></div><b>${item.count}</b></div>`).join('')}</div></div>
      </div>
      <div class="grid split">
        <div class="card pad"><div class="head"><h2>Smart Analysis</h2></div>${m.insights.map(i=>`<div class="row"><div class="info"><h4>${U.esc(i)}</h4><p class="muted">Generated from loaded omni-v2 records.</p></div></div>`).join('')}</div>
        <div class="card pad"><div class="head"><h2>System Health</h2></div><p>Relays connected: <b>${DB.state.connectedRelays.size}</b></p><p>Collections loaded: <b>${DB.state.hydrated.size} / ${collections.length}</b></p><p class="muted">Database actions require a live relay confirmation.</p></div>
      </div>`;
  }

  function renderVendors(){
    const vendors = searchRows(rows('vendors'));
    document.getElementById('vendors').innerHTML = `<div class="card pad"><div class="head"><h2>Vendor Vetting</h2><span class="pill warn">${vendors.filter(v=>v.status==='pending').length} pending</span></div>${UI.table(vendors, [
      {key:'crName',label:'CR Name'}, {key:'crNumber',label:'CR'}, {key:'businessType',label:'Type'},
      {key:'status',label:'Status'}, {key:'public',label:'Public'}, {key:'lat',label:'Lat'}, {key:'lng',label:'Lng'}, {key:'updatedAt',label:'Updated',format:r=>r.updatedAt?new Date(Number(r.updatedAt)).toLocaleString():'-'}
    ], row => `<button class="btn small primary" data-approve="${row.id}">Approve</button> <button class="btn small" data-hide="${row.id}">Hide</button> <button class="btn small danger" data-suspend="${row.id}">Suspend</button>`)}</div>`;
    document.querySelectorAll('[data-approve]').forEach(btn => btn.onclick = async () => {
      try {
      const vendor = rows('vendors').find(v=>v.id===btn.dataset.approve);
      const meta = adminMeta({vendorId:btn.dataset.approve});
      await DB.patch('vendors', btn.dataset.approve, {status:'approved', public:true, active:true, adminApproved:true, suspended:false, approvedAt:Date.now()}, meta);
      await DB.put('publicVendors', btn.dataset.approve, publicVendorPayload({...vendor, id:btn.dataset.approve, crName:vendor?.crName || 'Vendor', status:'approved', public:true, active:true, adminApproved:true, suspended:false}), meta);
      await DB.event('vendor_approved','vendor',btn.dataset.approve,{summary:'Vendor approved', vendorId:btn.dataset.approve},meta);
      UI.toast('Vendor approved and published','ok');
      } catch(error) { UI.toast(error.message || 'Vendor could not be approved','bad'); }
    });
    document.querySelectorAll('[data-hide]').forEach(btn => btn.onclick = async () => {
      try {
      const vendor = rows('vendors').find(v=>v.id===btn.dataset.hide) || {id:btn.dataset.hide, crName:'Vendor'};
      const meta = adminMeta({vendorId:btn.dataset.hide});
      await DB.patch('vendors', btn.dataset.hide, {public:false, active:false}, meta);
      await DB.put('publicVendors', btn.dataset.hide, publicVendorPayload(vendor, {public:false, active:false}), meta);
      UI.toast('Vendor hidden from public market','ok');
      } catch(error) { UI.toast(error.message || 'Vendor could not be hidden','bad'); }
    });
    document.querySelectorAll('[data-suspend]').forEach(btn => btn.onclick = async () => {
      try {
      const vendor = rows('vendors').find(v=>v.id===btn.dataset.suspend) || {id:btn.dataset.suspend, crName:'Vendor'};
      const meta = adminMeta({vendorId:btn.dataset.suspend});
      await DB.patch('vendors', btn.dataset.suspend, {status:'suspended', public:false, active:false, suspended:true}, meta);
      await DB.put('publicVendors', btn.dataset.suspend, publicVendorPayload(vendor, {status:'suspended', public:false, active:false, suspended:true}), meta);
      UI.toast('Vendor suspended','ok');
      } catch(error) { UI.toast(error.message || 'Vendor could not be suspended','bad'); }
    });
  }

  async function deleteUserAndRelated(user, permanent=false){
    const label = user.username || user.id;
    if(user.id === adminId()) return UI.toast('You cannot delete the SuperAdmin account currently in use','bad');
    if(permanent) {
      if(!DB.state.connectedRelays.size) return UI.toast('Connect to the relay before permanently deleting a user', 'bad');
      if(prompt(`Permanently delete ${label} and every related record? Type exactly:\nDELETE ${label}`) !== `DELETE ${label}`) return;
    } else if(!confirm(`Soft delete ${label} and related session/customer data?`)) return;
    if(user.role === 'superadmin' && rows('users').filter(item => item.role === 'superadmin').length <= 1) return UI.toast('The last SuperAdmin account cannot be deleted','bad');
    const meta = adminMeta(user);
    const sourceRows = collection => permanent ? (state[collection] || []) : rows(collection);
    const remove = (collection, id, row={}) => permanent
      ? DB.hardDelete(collection, id)
      : DB.softDelete(collection, id, {userId:adminId(), vendorId:row.vendorId || user.vendorId || ''});
    const removeRows = async (collection, predicate) => {
      await Promise.all(sourceRows(collection).filter(row => row.id && predicate(row)).map(row => remove(collection, row.id, row)));
    };
    await remove('users', user.id, user);
    await removeRows('presence', row => row.userId === user.id || row.id === user.id || row.username === user.username);
    await removeRows('passwordResets', row => row.userId === user.id || row.username === user.username);
    await removeRows('messages', row => row.userId === user.id || row.senderUserId === user.id || row.recipientUserId === user.id);
    await removeRows('notifications', row => row.userId === user.id || row.recipientUserId === user.id);
    await removeRows('employeeShifts', row => row.userId === user.id || (user.employeeId && row.employeeId === user.employeeId));
    await removeRows('employees', row => row.userId === user.id || (user.employeeId && row.id === user.employeeId));
    const customerRows = sourceRows('customers').filter(row => row.userId === user.id || row.id === user.customerId || (!!user.phone && row.phone === user.phone));
    const customerIds = new Set([user.customerId, ...customerRows.map(row => row.id)].filter(Boolean));
    await removeRows('customers', row => customerRows.some(customer => customer.id === row.id));
    await removeRows('customerLocations', row => customerIds.has(row.customerId));
    const customerCreditIds = new Set(sourceRows('creditAccounts').filter(row => customerIds.has(row.customerId) || (!!user.phone && row.phone === user.phone)).map(row => row.id));
    await removeRows('creditAccounts', row => customerCreditIds.has(row.id));
    await removeRows('creditTransactions', row => customerCreditIds.has(row.creditAccountId));
    const customerOrders = sourceRows('orders').filter(row => customerIds.has(row.customerId) || (!!user.phone && row.customerPhone === user.phone));
    const customerOrderIds = new Set(customerOrders.map(row => row.id));
    await removeRows('orders', row => customerOrderIds.has(row.id));
    await removeRows('orderItems', row => customerOrderIds.has(row.orderId));
    await removeRows('payments', row => customerOrderIds.has(row.orderId));
    await removeRows('deliveryAssignments', row => customerOrderIds.has(row.orderId));
    if(user.role === 'vendor_owner' && user.vendorId) {
      const relatedIds = new Set([user.vendorId]);
      ['products','orders','employees','branches','creditAccounts','deliveryAssignments','threads'].forEach(collection => {
        sourceRows(collection).filter(row => row.vendorId === user.vendorId).forEach(row => relatedIds.add(row.id));
      });
      sourceRows('users').filter(row => row.vendorId === user.vendorId).forEach(row => relatedIds.add(row.id));
      await removeRows('users', row => row.id !== user.id && row.vendorId === user.vendorId);
      const excluded = permanent ? ['users'] : ['users','events','auditLogs'];
      for(const collection of collections.filter(name => !excluded.includes(name))) {
        await removeRows(collection, row => row.vendorId === user.vendorId || (['vendors','publicVendors'].includes(collection) && row.id === user.vendorId) || Object.entries(row).some(([key,value]) => /Id$/.test(key) && relatedIds.has(value)));
      }
    }
    if(!permanent) await DB.event('user_related_data_deleted','user',user.id,{summary:`Soft deleted user and related records for ${label}`},meta);
    UI.toast(permanent ? 'User and related data permanently removed' : 'User and related data soft deleted','ok');
  }

  function renderUsers(){
    const presence = rows('presence');
    const users = searchRows(rows('users'));
    document.getElementById('users').innerHTML = `<div class="card pad"><div class="head"><h2>Users & Roles</h2><span class="pill ok">${presence.filter(p=>Date.now()-Number(p.updatedAt||0)<60000).length} online</span></div>${UI.table(users, [
      {key:'username',label:'Username'}, {key:'displayName',label:'Name'}, {key:'role',label:'Role'}, {key:'vendorId',label:'Vendor'}, {key:'customerId',label:'Customer'}, {key:'phone',label:'Phone'}, {key:'lastLoginAt',label:'Last login',format:r=>r.lastLoginAt?new Date(Number(r.lastLoginAt)).toLocaleString():'-'}
    ], row => `<button class="btn small danger" data-delete-user="${row.id}">Soft delete related</button> <button class="btn small danger ghost-danger" data-hard-delete-user="${row.id}">Permanent delete related</button>`)}</div>`;
    document.querySelectorAll('[data-delete-user]').forEach(btn => btn.onclick = async () => {
      try { await deleteUserAndRelated(rows('users').find(u=>u.id===btn.dataset.deleteUser) || {id:btn.dataset.deleteUser}, false); }
      catch(error) { UI.toast(error.message || 'User could not be deleted','bad'); }
    });
    document.querySelectorAll('[data-hard-delete-user]').forEach(btn => btn.onclick = async () => {
      try { await deleteUserAndRelated(rows('users').find(u=>u.id===btn.dataset.hardDeleteUser) || {id:btn.dataset.hardDeleteUser}, true); }
      catch(error) { UI.toast(error.message || 'User could not be permanently deleted','bad'); }
    });
  }

  function renderSimple(id, title, collection, columns){
    const list = searchRows(rows(collection));
    document.getElementById(id).innerHTML = `<div class="card pad"><div class="head"><h2>${U.esc(title)}</h2><span class="pill">${list.length} records</span></div>${UI.table(list, columns)}</div>`;
  }

  function renderAttendance(){
    const shifts=searchRows(rows('employeeShifts')).sort((a,b)=>Number(b.checkInAt||0)-Number(a.checkInAt||0));
    const now=Date.now();
    const duration=shift=>Math.max(0,(Number(shift.checkOutAt)||now)-Number(shift.checkInAt||now));
    const totalHours=shifts.reduce((sum,shift)=>sum+duration(shift),0)/3600000;
    const dayKeys=[...new Set(shifts.filter(shift=>shift.checkInAt).map(shift=>U.todayKey(Number(shift.checkInAt))))];
    const employees=new Set(shifts.map(shift=>shift.employeeId||shift.userId).filter(Boolean));
    const chartDays=Array.from({length:14},(_,index)=>{const date=new Date();date.setHours(0,0,0,0);date.setDate(date.getDate()-(13-index));const key=U.todayKey(date.getTime());const hours=shifts.filter(shift=>U.todayKey(Number(shift.checkInAt||0))===key).reduce((sum,shift)=>sum+duration(shift),0)/3600000;return {label:date.toLocaleDateString(undefined,{weekday:'short'}),hours};});
    const maxHours=Math.max(1,...chartDays.map(day=>day.hours));
    document.getElementById('attendance').innerHTML=`<div class="grid cols-4 attendance-metrics">${UI.stat('Hours recorded',totalHours.toFixed(1))}${UI.stat('Employees',employees.size)}${UI.stat('Days represented',dayKeys.length)}${UI.stat('Checked in now',shifts.filter(shift=>shift.status==='open').length,{text:'live',cls:'ok'})}</div><section class="card pad"><div class="head"><h2>Work hours · Last 14 days</h2></div><div class="attendance-chart">${chartDays.map(day=>`<div class="attendance-bar"><span style="height:${Math.max(day.hours?8:2,day.hours/maxHours*100)}%"></span><b>${day.hours?day.hours.toFixed(1):'0'}</b><small>${day.label}</small></div>`).join('')}</div></section><section class="card pad"><div class="head"><h2>Shift records</h2><span class="pill">${shifts.length} records</span></div>${UI.table(shifts,[{key:'employeeId',label:'Employee'},{key:'vendorId',label:'Vendor'},{key:'branchId',label:'Branch'},{key:'status',label:'Status'},{key:'checkInAt',label:'Check in',format:r=>r.checkInAt?new Date(Number(r.checkInAt)).toLocaleString():'-'},{key:'checkOutAt',label:'Check out',format:r=>r.checkOutAt?new Date(Number(r.checkOutAt)).toLocaleString():'-'},{key:'hours',label:'Hours',format:r=>(duration(r)/3600000).toFixed(2)}])}</section>`;
  }

  function renderEvents(){
    const events = searchRows(rows('events')).sort((a,b)=>Number(b.createdAt||0)-Number(a.createdAt||0)).slice(0,200);
    document.getElementById('events').innerHTML = `<div class="card pad"><div class="head"><h2>Audit Log</h2></div>${UI.table(events, [
      {key:'createdAt',label:'Time',format:r=>r.createdAt?new Date(Number(r.createdAt)).toLocaleString():'-'}, {key:'action',label:'Action'}, {key:'entityType',label:'Entity'}, {key:'entityId',label:'ID'}, {key:'summary',label:'Summary'}
    ])}</div>`;
  }

  function render(preserveFields=false){
    if(!appReady()) return;
    const view = UI.activeView();
    const fields = preserveFields ? captureViewFields(view) : [];
    if(view === 'dashboard') renderDashboard();
    if(view === 'vendors') renderVendors();
    if(view === 'users') renderUsers();
    if(view === 'orders') renderSimple('orders','Orders','orders', [{key:'id',label:'Order'}, {key:'vendorId',label:'Vendor'}, {key:'customerName',label:'Customer'}, {key:'status',label:'Status'}, {key:'total',label:'Total',format:r=>U.money(r.total)}]);
    if(view === 'credit') renderSimple('credit','Credit Accounts','creditAccounts', [{key:'phone',label:'Phone'}, {key:'vendorId',label:'Vendor'}, {key:'status',label:'Status'}, {key:'creditLimit',label:'Limit',format:r=>U.money(r.creditLimit)}, {key:'balance',label:'Balance',format:r=>U.money(r.balance)}]);
    if(view === 'attendance') renderAttendance();
    if(view === 'database') { document.getElementById('database').innerHTML = global.DatabaseBrowser.renderDatabase(state); global.DatabaseBrowser.bindDatabase(state, render); }
    if(view === 'events') renderEvents();
    if(preserveFields) restoreViewFields(fields);
  }

  function scheduleRender(collection){
    if(!appReady()) return;
    if(!viewUsesCollection(collection)) return;
    if(isEditingField()) {
      pendingRenders.add(collection);
      return;
    }
    if(renderTimer) clearTimeout(renderTimer);
    renderTimer = setTimeout(() => {
      renderTimer = null;
      render(true);
    }, 120);
  }

  async function exportAll(){
    if(!DB.state.connectedRelays.size) throw new Error('Connect to the relay before exporting.');
    await DB.hydrate();
    const data = {};
    for(const name of collections) data[name] = state[name] || [];
    U.downloadText(`omni-v2-backup-${U.todayKey()}.json`, JSON.stringify(data, null, 2), 'application/json');
  }

  function syncPresence(){
    if(!currentAdmin) return;
    DB.put('presence', adminId(), {id:adminId(), userId:adminId(), username:currentAdmin.username || '', role:'superadmin', mode:'superadmin', view:UI.activeView?.() || 'dashboard', online:true, updatedAt:Date.now()}, adminMeta()).catch(() => {});
  }

  function stopAdmin(){
    clearInterval(presenceTimer);
    presenceTimer = null;
    liveUnsubscribers.forEach(unsubscribe => unsubscribe());
    liveUnsubscribers = [];
    pendingRenders.clear();
  }

  function startAdmin(user){
    currentAdmin = {...user, id:user.id || user.userId};
    global.OmniAdminContext = {userId:adminId(), username:currentAdmin.username || ''};
    UI.shell(currentAdmin);
    UI.bindNav(render);
    DB.init(UI.setStatus);
    stopAdmin();
    collections.forEach(name => liveUnsubscribers.push(DB.subscribe(name, () => scheduleRender(name), {includeDeleted:true})));
    document.getElementById('backupBtn').onclick = async () => {
      try { await exportAll(); UI.toast('Full database export created','ok'); }
      catch(error) { UI.toast(error.message || 'Export failed','bad'); }
    };
    document.getElementById('logoutBtn').onclick = () => {
      global.OmniAuth.clearSession();
      delete global.OmniAdminContext;
      currentAdmin = null;
      stopAdmin();
      boot();
    };
    document.getElementById('globalSearch').oninput = () => scheduleRender('search');
    document.getElementById('app').onfocusout = () => setTimeout(flushPendingRender, 0);
    syncPresence();
    presenceTimer = setInterval(syncPresence, 30000);
    render();
  }

  function renderAuthGate(allowSetup=false){
    UI.authGate({allowSetup});
    UI.setStatus(DB.state.status);
    document.getElementById('adminLoginForm').onsubmit = async event => {
      event.preventDefault();
      try { startAdmin(await global.OmniAuth.login(document.getElementById('adminLoginUsername').value, document.getElementById('adminLoginPassword').value)); }
      catch(error) { UI.toast(error.message || 'Sign in failed','bad'); }
    };
    document.getElementById('adminSetupForm')?.addEventListener('submit', async event => {
      event.preventDefault();
      try { startAdmin(await global.OmniAuth.createInitialAdmin({displayName:document.getElementById('adminSetupName').value, username:document.getElementById('adminSetupUsername').value, password:document.getElementById('adminSetupPassword').value})); }
      catch(error) { UI.toast(error.message || 'Initial SuperAdmin could not be created','bad'); }
    });
  }

  async function boot(){
    DB.init(UI.setStatus);
    const session = global.OmniAuth.savedSession();
    if(session?.userId) {
      try {
        const user = await DB.get('users', session.userId, 8000);
        if(user && user.role === 'superadmin' && user.active !== false && user.deleted !== true) {
          global.OmniAuth.saveSession(user);
          startAdmin(user);
          return;
        }
      } catch {}
      global.OmniAuth.clearSession();
    }
    let allowSetup = false;
    try { allowSetup = !(await global.OmniAuth.hasActiveAdmin()); } catch {}
    renderAuthGate(allowSetup);
  }

  boot();
})(window);

(function(global){
  'use strict';

  const U = global.OmniUtils;
  const DB = global.OmniDB;
  const UI = global.SuperUI;
  const collections = global.OmniConfig.collections;
  const state = DB.state.cache;
  let renderTimer = null;
  const pendingRenders = new Set();

  function rows(name){ return (state[name] || []).filter(row => row.deleted !== true); }
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
  function vendorProducts(vendorId){ return rows('products').filter(p => p.vendorId === vendorId && p.active !== false); }
  function publicVendorPayload(vendor, overrides={}){
    const products = vendorProducts(vendor.id).map(p=>({id:p.id,name:p.name,category:p.category||'',description:p.description||'',itemType:p.itemType||'product',price:Number(p.price||0),compareAtPrice:Number(p.compareAtPrice||0),unit:p.unit||'each',taxRate:Number(p.taxRate||0),image:p.image||'',imagesJson:p.imagesJson||JSON.stringify(p.image?[p.image]:[]),attributesJson:p.attributesJson||'[]',barcode:p.barcode||'',qrCode:p.qrCode||'',sku:p.sku||'',stockMode:p.stockMode||'none',stockQty:Number(p.stockQty||0),lowStockThreshold:Number(p.lowStockThreshold||0),preparationMinutes:Number(p.preparationMinutes||0),featured:p.featured===true,active:p.active!==false,updatedAt:p.updatedAt||Date.now()}));
    return {...vendor, ...overrides, id:vendor.id, products:JSON.stringify(products), updatedAt:Date.now()};
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
        <div class="card pad"><div class="head"><h2>System Health</h2></div><p>Relays connected: <b>${DB.state.connectedRelays.size}</b></p><p>Collections loaded: <b>${collections.length}</b></p><p class="muted">Use Database to export/import records.</p></div>
      </div>`;
  }

  function renderVendors(){
    const vendors = searchRows(rows('vendors'));
    document.getElementById('vendors').innerHTML = `<div class="card pad"><div class="head"><h2>Vendor Vetting</h2><span class="pill warn">${vendors.filter(v=>v.status==='pending').length} pending</span></div>${UI.table(vendors, [
      {key:'crName',label:'CR Name'}, {key:'crNumber',label:'CR'}, {key:'businessType',label:'Type'},
      {key:'status',label:'Status'}, {key:'public',label:'Public'}, {key:'lat',label:'Lat'}, {key:'lng',label:'Lng'}, {key:'updatedAt',label:'Updated',format:r=>r.updatedAt?new Date(Number(r.updatedAt)).toLocaleString():'-'}
    ], row => `<button class="btn small primary" data-approve="${row.id}">Approve</button> <button class="btn small" data-hide="${row.id}">Hide</button> <button class="btn small danger" data-suspend="${row.id}">Suspend</button>`)}</div>`;
    document.querySelectorAll('[data-approve]').forEach(btn => btn.onclick = async () => {
      const vendor = rows('vendors').find(v=>v.id===btn.dataset.approve);
      await DB.patch('vendors', btn.dataset.approve, {status:'approved', public:true, active:true, adminApproved:true, suspended:false, approvedAt:Date.now()}, {userId:'superadmin'});
      await DB.put('publicVendors', btn.dataset.approve, publicVendorPayload({...vendor, id:btn.dataset.approve, crName:vendor?.crName || 'Vendor', status:'approved', public:true, active:true, adminApproved:true, suspended:false}), {userId:'superadmin', vendorId:btn.dataset.approve});
      await DB.event('vendor_approved','vendor',btn.dataset.approve,{summary:'Vendor approved', vendorId:btn.dataset.approve},{userId:'superadmin'});
      UI.toast('Vendor approved and published','ok');
    });
    document.querySelectorAll('[data-hide]').forEach(btn => btn.onclick = async () => {
      const vendor = rows('vendors').find(v=>v.id===btn.dataset.hide) || {id:btn.dataset.hide, crName:'Vendor'};
      await DB.patch('vendors', btn.dataset.hide, {public:false, active:false}, {userId:'superadmin'});
      await DB.put('publicVendors', btn.dataset.hide, publicVendorPayload(vendor, {public:false, active:false}), {userId:'superadmin', vendorId:btn.dataset.hide});
      UI.toast('Vendor hidden from public market','ok');
    });
    document.querySelectorAll('[data-suspend]').forEach(btn => btn.onclick = async () => {
      const vendor = rows('vendors').find(v=>v.id===btn.dataset.suspend) || {id:btn.dataset.suspend, crName:'Vendor'};
      await DB.patch('vendors', btn.dataset.suspend, {status:'suspended', public:false, active:false, suspended:true}, {userId:'superadmin'});
      await DB.put('publicVendors', btn.dataset.suspend, publicVendorPayload(vendor, {status:'suspended', public:false, active:false, suspended:true}), {userId:'superadmin', vendorId:btn.dataset.suspend});
      UI.toast('Vendor suspended','ok');
    });
  }

  async function deleteUserAndRelated(user){
    if(!confirm(`Delete ${user.username || user.id} and related session/customer data?`)) return;
    if(user.role === 'superadmin' && rows('users').filter(item => item.role === 'superadmin').length <= 1) return UI.toast('The last SuperAdmin account cannot be deleted','bad');
    const meta = {userId:'superadmin', vendorId:user.vendorId || ''};
    const removeRows = async (collection, predicate) => {
      await Promise.all(rows(collection).filter(predicate).map(row => DB.softDelete(collection, row.id, {userId:'superadmin', vendorId:row.vendorId || user.vendorId || ''})));
    };
    await DB.softDelete('users', user.id, {userId:'superadmin', vendorId:user.vendorId || ''});
    await removeRows('presence', row => row.userId === user.id || row.id === user.id || row.username === user.username);
    await removeRows('passwordResets', row => row.userId === user.id || row.username === user.username);
    await removeRows('messages', row => row.userId === user.id || row.senderUserId === user.id || row.recipientUserId === user.id);
    await removeRows('notifications', row => row.userId === user.id || row.recipientUserId === user.id);
    await removeRows('employeeShifts', row => row.userId === user.id || (user.employeeId && row.employeeId === user.employeeId));
    await removeRows('employees', row => row.userId === user.id || (user.employeeId && row.id === user.employeeId));
    const customerRows = rows('customers').filter(row => row.userId === user.id || row.id === user.customerId || (!!user.phone && row.phone === user.phone));
    const customerIds = new Set([user.customerId, ...customerRows.map(row => row.id)].filter(Boolean));
    await removeRows('customers', row => customerRows.some(customer => customer.id === row.id));
    await removeRows('customerLocations', row => customerIds.has(row.customerId));
    const customerCreditIds = new Set(rows('creditAccounts').filter(row => customerIds.has(row.customerId) || (!!user.phone && row.phone === user.phone)).map(row => row.id));
    await removeRows('creditAccounts', row => customerCreditIds.has(row.id));
    await removeRows('creditTransactions', row => customerCreditIds.has(row.creditAccountId));
    const customerOrders = rows('orders').filter(row => customerIds.has(row.customerId));
    const customerOrderIds = new Set(customerOrders.map(row => row.id));
    await removeRows('orders', row => customerOrderIds.has(row.id));
    await removeRows('orderItems', row => customerOrderIds.has(row.orderId));
    await removeRows('payments', row => customerOrderIds.has(row.orderId));
    if(user.role === 'vendor_owner' && user.vendorId) {
      await removeRows('users', row => row.id !== user.id && row.vendorId === user.vendorId);
      for(const collection of collections.filter(name => !['users','events','auditLogs'].includes(name))) {
        await removeRows(collection, row => row.vendorId === user.vendorId || (['vendors','publicVendors'].includes(collection) && row.id === user.vendorId));
      }
    }
    await DB.event('user_related_data_deleted','user',user.id,{summary:`Deleted user and related records for ${user.username || user.id}`},meta);
    UI.toast('User and related data deleted','ok');
  }

  function renderUsers(){
    const presence = rows('presence');
    const users = searchRows(rows('users'));
    document.getElementById('users').innerHTML = `<div class="card pad"><div class="head"><h2>Users & Roles</h2><span class="pill ok">${presence.filter(p=>Date.now()-Number(p.updatedAt||0)<60000).length} online</span></div>${UI.table(users, [
      {key:'username',label:'Username'}, {key:'displayName',label:'Name'}, {key:'role',label:'Role'}, {key:'vendorId',label:'Vendor'}, {key:'customerId',label:'Customer'}, {key:'phone',label:'Phone'}, {key:'lastLoginAt',label:'Last login',format:r=>r.lastLoginAt?new Date(Number(r.lastLoginAt)).toLocaleString():'-'}
    ], row => `<button class="btn small danger" data-delete-user="${row.id}">Delete related</button>`)}</div>`;
    document.querySelectorAll('[data-delete-user]').forEach(btn => btn.onclick = async () => deleteUserAndRelated(rows('users').find(u=>u.id===btn.dataset.deleteUser) || {id:btn.dataset.deleteUser}));
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
    const data = {};
    for(const name of collections) data[name] = state[name] || [];
    U.downloadText(`omni-v2-backup-${U.todayKey()}.json`, JSON.stringify(data, null, 2), 'application/json');
  }

  function boot(){
    UI.shell();
    UI.bindNav(render);
    DB.init(UI.setStatus);
    collections.forEach(name => DB.subscribe(name, () => scheduleRender(name), {includeDeleted:true}));
    document.getElementById('backupBtn').onclick = exportAll;
    document.getElementById('globalSearch').oninput = () => scheduleRender('search');
    document.getElementById('app').onfocusout = () => setTimeout(flushPendingRender, 0);
    render();
  }

  boot();
})(window);

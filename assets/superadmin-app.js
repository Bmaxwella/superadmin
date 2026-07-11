(function(global){
  'use strict';

  const U = global.OmniUtils;
  const DB = global.OmniDB;
  const UI = global.SuperUI;
  const collections = global.OmniConfig.collections;
  const state = DB.state.cache;
  let renderTimer = null;

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
  function searchRows(list){
    const query = (document.getElementById('globalSearch')?.value || '').trim().toLowerCase();
    if(!query) return list;
    return list.filter(row => JSON.stringify(row).toLowerCase().includes(query));
  }
  function vendorProducts(vendorId){ return rows('products').filter(p => p.vendorId === vendorId && p.active !== false); }
  function publicVendorPayload(vendor, overrides={}){
    const products = vendorProducts(vendor.id).map(p=>({id:p.id,name:p.name,category:p.category||'',description:p.description||'',price:Number(p.price||0),image:p.image||'',barcode:p.barcode||'',qrCode:p.qrCode||'',sku:p.sku||'',stockQty:Number(p.stockQty||0),active:p.active!==false,updatedAt:p.updatedAt||Date.now()}));
    return {...vendor, ...overrides, id:vendor.id, products:JSON.stringify(products), updatedAt:Date.now()};
  }

  function renderDashboard(){
    const m = global.SuperAnalytics.metrics(state);
    document.getElementById('dashboard').innerHTML = `
      <div class="grid cols-4">${m.cards.map(c=>UI.stat(c[0],c[1],c[2])).join('')}</div>
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
    await DB.softDelete('users', user.id, {userId:'superadmin', vendorId:user.vendorId || ''});
    await Promise.all(rows('presence').filter(p => p.userId === user.id || p.id === user.id || p.username === user.username).map(p => DB.softDelete('presence', p.id, {userId:'superadmin'})));
    await Promise.all(rows('customers').filter(c => c.userId === user.id || c.id === user.customerId || c.phone === user.phone).map(c => DB.softDelete('customers', c.id, {userId:'superadmin'})));
    await Promise.all(rows('creditAccounts').filter(c => c.customerId === user.customerId || c.phone === user.phone).map(c => DB.softDelete('creditAccounts', c.id, {userId:'superadmin', vendorId:c.vendorId || ''})));
    await Promise.all(rows('passwordResets').filter(r => r.userId === user.id || r.username === user.username).map(r => DB.softDelete('passwordResets', r.id, {userId:'superadmin'})));
    await DB.event('user_related_data_deleted','user',user.id,{summary:`Deleted user and related records for ${user.username || user.id}`},{userId:'superadmin'});
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

  function renderEvents(){
    const events = searchRows(rows('events')).sort((a,b)=>Number(b.createdAt||0)-Number(a.createdAt||0)).slice(0,200);
    document.getElementById('events').innerHTML = `<div class="card pad"><div class="head"><h2>Audit Log</h2></div>${UI.table(events, [
      {key:'createdAt',label:'Time',format:r=>r.createdAt?new Date(Number(r.createdAt)).toLocaleString():'-'}, {key:'action',label:'Action'}, {key:'entityType',label:'Entity'}, {key:'entityId',label:'ID'}, {key:'summary',label:'Summary'}
    ])}</div>`;
  }

  function render(){
    if(!appReady()) return;
    const view = UI.activeView();
    if(view === 'dashboard') renderDashboard();
    if(view === 'vendors') renderVendors();
    if(view === 'users') renderUsers();
    if(view === 'orders') renderSimple('orders','Orders','orders', [{key:'id',label:'Order'}, {key:'vendorId',label:'Vendor'}, {key:'customerName',label:'Customer'}, {key:'status',label:'Status'}, {key:'total',label:'Total',format:r=>U.money(r.total)}]);
    if(view === 'credit') renderSimple('credit','Credit Accounts','creditAccounts', [{key:'phone',label:'Phone'}, {key:'vendorId',label:'Vendor'}, {key:'status',label:'Status'}, {key:'creditLimit',label:'Limit',format:r=>U.money(r.creditLimit)}, {key:'balance',label:'Balance',format:r=>U.money(r.balance)}]);
    if(view === 'attendance') renderSimple('attendance','Attendance','employeeShifts', [{key:'employeeId',label:'Employee'}, {key:'branchId',label:'Branch'}, {key:'status',label:'Status'}, {key:'checkInAt',label:'Check in',format:r=>r.checkInAt?new Date(Number(r.checkInAt)).toLocaleString():'-'}]);
    if(view === 'database') { document.getElementById('database').innerHTML = global.DatabaseBrowser.renderDatabase(state); global.DatabaseBrowser.bindDatabase(state, render); }
    if(view === 'events') renderEvents();
  }

  function scheduleRender(collection){
    if(!appReady()) return;
    if(collection === 'events' && UI.activeView() !== 'events' && UI.activeView() !== 'dashboard') return;
    if(isEditingField()) return;
    if(renderTimer) clearTimeout(renderTimer);
    renderTimer = setTimeout(() => {
      renderTimer = null;
      render();
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
    render();
  }

  boot();
})(window);

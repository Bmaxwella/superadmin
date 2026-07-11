(function(global){
  'use strict';

  const U = global.OmniUtils;
  const DB = global.OmniDB;
  const UI = global.SuperUI;
  const collections = global.OmniConfig.collections;
  const state = DB.state.cache;

  function rows(name){ return (state[name] || []).filter(row => row.deleted !== true); }

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
    const vendors = rows('vendors');
    document.getElementById('vendors').innerHTML = `<div class="card pad"><div class="head"><h2>Vendor Vetting</h2><span class="pill warn">${vendors.filter(v=>v.status==='pending').length} pending</span></div>${UI.table(vendors, [
      {key:'crName',label:'CR Name'}, {key:'crNumber',label:'CR'}, {key:'businessType',label:'Type'},
      {key:'status',label:'Status'}, {key:'public',label:'Public'}, {key:'updatedAt',label:'Updated',format:r=>r.updatedAt?new Date(Number(r.updatedAt)).toLocaleString():'-'}
    ], row => `<button class="btn small primary" data-approve="${row.id}">Approve</button> <button class="btn small" data-hide="${row.id}">Hide</button> <button class="btn small danger" data-suspend="${row.id}">Suspend</button>`)}</div>`;
    document.querySelectorAll('[data-approve]').forEach(btn => btn.onclick = async () => { await DB.patch('vendors', btn.dataset.approve, {status:'approved', public:true, active:true}, {userId:'superadmin'}); await DB.event('vendor_approved','vendor',btn.dataset.approve,{summary:'Vendor approved'},{userId:'superadmin'}); UI.toast('Vendor approved','ok'); });
    document.querySelectorAll('[data-hide]').forEach(btn => btn.onclick = async () => { await DB.patch('vendors', btn.dataset.hide, {public:false}, {userId:'superadmin'}); UI.toast('Vendor hidden','ok'); });
    document.querySelectorAll('[data-suspend]').forEach(btn => btn.onclick = async () => { await DB.patch('vendors', btn.dataset.suspend, {status:'suspended', public:false}, {userId:'superadmin'}); UI.toast('Vendor suspended','ok'); });
  }

  function renderUsers(){
    document.getElementById('users').innerHTML = `<div class="card pad"><div class="head"><h2>Users & Roles</h2></div>${UI.table(rows('users'), [
      {key:'username',label:'Username'}, {key:'displayName',label:'Name'}, {key:'role',label:'Role'}, {key:'vendorId',label:'Vendor'}, {key:'phone',label:'Phone'}, {key:'updatedAt',label:'Updated',format:r=>r.updatedAt?new Date(Number(r.updatedAt)).toLocaleString():'-'}
    ], row => `<button class="btn small danger" data-delete-user="${row.id}">Soft delete</button>`)}</div>`;
    document.querySelectorAll('[data-delete-user]').forEach(btn => btn.onclick = async () => { if(confirm('Soft delete this user?')) { await DB.softDelete('users', btn.dataset.deleteUser, {userId:'superadmin'}); UI.toast('User soft deleted','ok'); } });
  }

  function renderSimple(id, title, collection, columns){
    document.getElementById(id).innerHTML = `<div class="card pad"><div class="head"><h2>${U.esc(title)}</h2><span class="pill">${rows(collection).length} records</span></div>${UI.table(rows(collection), columns)}</div>`;
  }

  function renderEvents(){
    const events = rows('events').sort((a,b)=>Number(b.createdAt||0)-Number(a.createdAt||0)).slice(0,200);
    document.getElementById('events').innerHTML = `<div class="card pad"><div class="head"><h2>Audit Log</h2></div>${UI.table(events, [
      {key:'createdAt',label:'Time',format:r=>r.createdAt?new Date(Number(r.createdAt)).toLocaleString():'-'}, {key:'action',label:'Action'}, {key:'entityType',label:'Entity'}, {key:'entityId',label:'ID'}, {key:'summary',label:'Summary'}
    ])}</div>`;
  }

  function render(){
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

  async function exportAll(){
    const data = {};
    for(const name of collections) data[name] = await DB.exportCollection(name);
    U.downloadText(`omni-v2-backup-${U.todayKey()}.json`, JSON.stringify(data, null, 2), 'application/json');
  }

  function boot(){
    UI.shell();
    UI.bindNav(render);
    DB.init(UI.setStatus);
    collections.forEach(name => DB.subscribe(name, render, {includeDeleted:true}));
    document.getElementById('backupBtn').onclick = exportAll;
    render();
  }

  boot();
})(window);

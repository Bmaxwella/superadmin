(function(global){
  'use strict';

  const U = global.OmniUtils;
  const prefs = {
    collection: 'vendors',
    includeDeleted: true,
    query: '',
    editingId: '',
    mode: 'create'
  };

  function escJson(value){
    return U.esc(JSON.stringify(value || {}, null, 2));
  }

  function collectionRows(cache, collection){
    return cache[collection] || [];
  }

  function filteredRows(cache, collection){
    const query = prefs.query.trim().toLowerCase();
    return collectionRows(cache, collection)
      .filter(row => prefs.includeDeleted || row.deleted !== true)
      .filter(row => !query || JSON.stringify(row).toLowerCase().includes(query))
      .sort((a,b) => Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0));
  }

  function visibleKeys(rows){
    const priority = ['id','username','crName','name','vendorId','customerId','role','status','active','deleted','total','updatedAt'];
    const all = [...new Set(rows.flatMap(row => Object.keys(row || {})))];
    return [...priority.filter(key => all.includes(key)), ...all.filter(key => !priority.includes(key))].slice(0, 14);
  }

  function selectedRecord(cache){
    const rows = collectionRows(cache, prefs.collection);
    return rows.find(row => row.id === prefs.editingId) || null;
  }

  function defaultRecord(collection){
    const id = U.uid(collection.replace(/s$/,'') || 'row');
    const base = {
      id,
      active: true,
      deleted: false,
      status: 'active'
    };
    if(collection === 'users') return {...base, username:'new_user', displayName:'New User', role:'customer'};
    if(collection === 'vendors') return {...base, crName:'New Vendor', crNumber:'', businessType:'General', status:'pending', public:false, adminApproved:false, suspended:false};
    if(collection === 'publicVendors') return {...base, crName:'New Public Vendor', products:'[]', status:'approved', public:true};
    if(collection === 'products') return {...base, vendorId:'', name:'New Product', price:0, category:'General'};
    if(collection === 'orders') return {...base, vendorId:'', status:'pending', total:0, paymentMethod:'cash'};
    return base;
  }

  function normalizeValue(value){
    if(value === undefined) return '';
    if(value === null) return '';
    if(Array.isArray(value) || (value && typeof value === 'object')) return JSON.stringify(value);
    return value;
  }

  function normalizeRecord(input, collection){
    if(!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Record JSON must be one object.');
    const out = {};
    Object.keys(input).forEach(key => {
      if(key === '_') return;
      out[key] = normalizeValue(input[key]);
    });
    out.id = String(out.id || U.uid(collection.replace(/s$/,'') || 'row')).trim();
    if(!out.id) throw new Error('Record id is required.');
    return out;
  }

  function renderCollectionSummary(cache){
    return global.OmniConfig.collections.map(name => {
      const all = collectionRows(cache, name);
      const live = all.filter(row => row.deleted !== true).length;
      const deleted = all.length - live;
      return `<button class="db-chip ${prefs.collection===name?'active':''}" data-db-collection-pick="${U.esc(name)}"><b>${U.esc(name)}</b><span>${live}${deleted?` / ${deleted} deleted`:''}</span></button>`;
    }).join('');
  }

  function renderTable(rows){
    if(!rows.length) return '<div class="card empty">No records match this database view.</div>';
    const keys = visibleKeys(rows);
    return `<div class="table-wrap db-table"><table class="table"><thead><tr><th>Actions</th>${keys.map(k=>`<th>${U.esc(k)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr class="${row.deleted===true?'deleted-row':''}"><td class="db-actions"><button class="btn small primary" data-edit-record="${U.esc(row.id)}">Edit</button>${row.deleted===true?` <button class="btn small" data-restore-record="${U.esc(row.id)}">Restore</button>`:` <button class="btn small danger" data-delete-record="${U.esc(row.id)}">Delete</button>`}</td>${keys.map(k=>`<td>${U.esc(String(row[k] ?? '').slice(0,180))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }

  function renderEditor(cache){
    const record = prefs.mode === 'edit' ? selectedRecord(cache) : null;
    const value = record || defaultRecord(prefs.collection);
    return `<form id="dbEditorForm" class="card pad form db-editor">
      <div class="head"><h2>${prefs.mode === 'edit' ? 'Edit Record' : 'Create Record'}</h2><span class="pill">${U.esc(prefs.collection)}</span><div class="spacer"></div>${prefs.mode === 'edit' ? '<button type="button" id="newRecordBtn" class="btn">New</button>' : ''}</div>
      <div class="field full"><label>Record JSON</label><textarea id="recordJson" spellcheck="false">${escJson(value)}</textarea></div>
      <div class="db-editor-actions">
        <button class="btn primary">${prefs.mode === 'edit' ? 'Save changes' : 'Create record'}</button>
        ${prefs.mode === 'edit' && record?.deleted !== true ? '<button type="button" id="editorDeleteBtn" class="btn danger">Delete record</button>' : ''}
        ${prefs.mode === 'edit' && record?.deleted === true ? '<button type="button" id="editorRestoreBtn" class="btn">Restore record</button>' : ''}
      </div>
      <p class="muted">Objects and arrays are saved as JSON strings so the GUN record stays compatible with the rest of the suite.</p>
    </form>`;
  }

  function renderDatabase(cache){
    const collections = global.OmniConfig.collections;
    if(!collections.includes(prefs.collection)) prefs.collection = collections[0] || 'users';
    const rows = filteredRows(cache, prefs.collection);
    const allRows = collectionRows(cache, prefs.collection);
    const liveRows = allRows.filter(row => row.deleted !== true);
    const deletedRows = allRows.filter(row => row.deleted === true);
    return `
      <div class="grid db-layout">
        <section class="card pad db-sidebar">
          <div class="head"><h2>GUN Project Data</h2><span class="pill ok">${global.OmniConfig.collections.length} collections</span></div>
          <div class="db-chips">${renderCollectionSummary(cache)}</div>
        </section>
        <section class="grid">
          <div class="card pad">
            <div class="head">
              <h2>Database Spreadsheet</h2><span class="pill ok">${U.esc(prefs.collection)}</span><span class="pill">${liveRows.length} live</span><span class="pill ${deletedRows.length?'bad':''}">${deletedRows.length} deleted</span><div class="spacer"></div>
              <select id="dbCollection" class="input db-select">${collections.map(c=>`<option ${c===prefs.collection?'selected':''}>${U.esc(c)}</option>`).join('')}</select>
            </div>
            <div class="db-toolbar">
              <div class="search"><span>⌕</span><input id="dbSearch" value="${U.esc(prefs.query)}" placeholder="Search this collection"></div>
              <button id="applyDbSearchBtn" class="btn">Search</button>
              <label class="db-toggle"><input id="includeDeleted" type="checkbox" ${prefs.includeDeleted?'checked':''}> Show deleted</label>
              <button id="newRecordTopBtn" class="btn primary">New record</button>
              <button id="exportCsvBtn" class="btn">Export CSV</button>
              <button id="exportJsonBtn" class="btn">Export JSON</button>
            </div>
          </div>
          ${renderTable(rows)}
          ${renderEditor(cache)}
          <div class="card pad form">
            <div class="head"><h2>Import JSON</h2><span class="pill">${U.esc(prefs.collection)}</span></div>
            <div class="field full"><label>Paste one record object or an array of records</label><textarea id="importJson" placeholder='[{"id":"..."}]'></textarea></div>
            <button id="importJsonBtn" class="btn primary">Import into selected collection</button>
          </div>
        </section>
      </div>`;
  }

  function parseEditorJson(id){
    const raw = document.getElementById(id)?.value || '';
    const parsed = U.parseJson(raw, null);
    if(!parsed) throw new Error('JSON is invalid.');
    return parsed;
  }

  async function saveRecord(rerender){
    const record = normalizeRecord(parseEditorJson('recordJson'), prefs.collection);
    await global.OmniDB.put(prefs.collection, record.id, record, {userId:'superadmin', vendorId:record.vendorId || ''});
    await global.OmniDB.event(prefs.mode === 'edit' ? 'database_record_updated' : 'database_record_created', prefs.collection, record.id, {summary:`${prefs.mode === 'edit' ? 'Updated' : 'Created'} ${prefs.collection}/${record.id}`, vendorId:record.vendorId || ''}, {userId:'superadmin', vendorId:record.vendorId || ''});
    prefs.mode = 'edit';
    prefs.editingId = record.id;
    global.SuperUI.toast('Record saved to GUN', 'ok');
    rerender();
  }

  async function softDeleteRecord(id, rerender){
    if(!id) return;
    if(!confirm(`Delete ${prefs.collection}/${id}? This marks the record deleted and keeps an audit trail.`)) return;
    const record = collectionRows(global.OmniDB.state.cache, prefs.collection).find(row => row.id === id) || {};
    await global.OmniDB.softDelete(prefs.collection, id, {userId:'superadmin', vendorId:record.vendorId || ''});
    global.SuperUI.toast('Record deleted', 'ok');
    rerender();
  }

  async function restoreRecord(id, rerender){
    if(!id) return;
    const record = collectionRows(global.OmniDB.state.cache, prefs.collection).find(row => row.id === id) || {};
    await global.OmniDB.patch(prefs.collection, id, {deleted:false, active:record.active === false ? true : record.active, deletedAt:''}, {userId:'superadmin', vendorId:record.vendorId || ''});
    await global.OmniDB.event('database_record_restored', prefs.collection, id, {summary:`Restored ${prefs.collection}/${id}`, vendorId:record.vendorId || ''}, {userId:'superadmin', vendorId:record.vendorId || ''});
    global.SuperUI.toast('Record restored', 'ok');
    rerender();
  }

  function bindDatabase(cache, rerender){
    const select = document.getElementById('dbCollection');
    if(select) select.onchange = () => { prefs.collection = select.value; prefs.editingId = ''; prefs.mode = 'create'; rerender(); };
    document.querySelectorAll('[data-db-collection-pick]').forEach(btn => btn.onclick = () => {
      prefs.collection = btn.dataset.dbCollectionPick;
      prefs.editingId = '';
      prefs.mode = 'create';
      rerender();
    });
    document.getElementById('includeDeleted')?.addEventListener('change', e => { prefs.includeDeleted = e.target.checked; rerender(); });
    document.getElementById('dbSearch')?.addEventListener('input', e => { prefs.query = e.target.value; });
    document.getElementById('dbSearch')?.addEventListener('keydown', e => { if(e.key === 'Enter') rerender(); });
    document.getElementById('applyDbSearchBtn')?.addEventListener('click', rerender);
    document.getElementById('newRecordTopBtn')?.addEventListener('click', () => { prefs.mode = 'create'; prefs.editingId = ''; rerender(); });
    document.getElementById('newRecordBtn')?.addEventListener('click', () => { prefs.mode = 'create'; prefs.editingId = ''; rerender(); });
    document.querySelectorAll('[data-edit-record]').forEach(btn => btn.onclick = () => { prefs.mode = 'edit'; prefs.editingId = btn.dataset.editRecord; rerender(); });
    document.querySelectorAll('[data-delete-record]').forEach(btn => btn.onclick = () => softDeleteRecord(btn.dataset.deleteRecord, rerender));
    document.querySelectorAll('[data-restore-record]').forEach(btn => btn.onclick = () => restoreRecord(btn.dataset.restoreRecord, rerender));
    document.getElementById('editorDeleteBtn')?.addEventListener('click', () => softDeleteRecord(prefs.editingId, rerender));
    document.getElementById('editorRestoreBtn')?.addEventListener('click', () => restoreRecord(prefs.editingId, rerender));
    document.getElementById('dbEditorForm')?.addEventListener('submit', async e => {
      e.preventDefault();
      try { await saveRecord(rerender); }
      catch(error) { global.SuperUI.toast(error.message || 'Record could not be saved', 'bad'); }
    });
    document.getElementById('exportCsvBtn')?.addEventListener('click', () => {
      const rows = filteredRows(cache, prefs.collection);
      U.downloadText(`${prefs.collection}.csv`, U.toCsv(rows), 'text/csv');
    });
    document.getElementById('exportJsonBtn')?.addEventListener('click', () => {
      const rows = filteredRows(cache, prefs.collection);
      U.downloadText(`${prefs.collection}.json`, JSON.stringify(rows, null, 2), 'application/json');
    });
    document.getElementById('importJsonBtn')?.addEventListener('click', async () => {
      try {
        const parsed = parseEditorJson('importJson');
        const rows = Array.isArray(parsed) ? parsed : [parsed];
        const normalized = rows.map(row => normalizeRecord(row, prefs.collection));
        await global.OmniDB.importRows(prefs.collection, normalized, {userId:'superadmin'});
        global.SuperUI.toast(`Imported ${normalized.length} row(s)`, 'ok');
        rerender();
      } catch(error) {
        global.SuperUI.toast(error.message || 'Import failed', 'bad');
      }
    });
  }

  global.DatabaseBrowser = { renderDatabase, bindDatabase };
})(window);

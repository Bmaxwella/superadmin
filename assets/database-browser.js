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

  function adminMeta(record={}){
    const userId = global.OmniAdminContext?.userId;
    if(!userId) throw new Error('SuperAdmin authentication is required.');
    return {userId, vendorId:record.vendorId || ''};
  }

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

  function cellDisplay(key, value){
    if(value === true) return 'Yes';
    if(value === false) return 'No';
    if(value === null || value === undefined || value === '') return '—';
    if(/(?:At|Date)$/i.test(key) && Number(value) > 1000000000000) {
      try { return new Date(Number(value)).toLocaleString(); } catch {}
    }
    const text = String(value);
    if((text.startsWith('{') || text.startsWith('[')) && text.length > 90) return `${text.slice(0,87)}…`;
    return text.length > 140 ? `${text.slice(0,137)}…` : text;
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
    if(collection === 'products') return {...base, vendorId:'', name:'New Product', price:0, category:'General', itemType:'product', unit:'each', imagesJson:'[]', attributesJson:'[]', stockMode:'none', stockQty:0};
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
    const visible = rows.slice(0,250);
    return `<section class="card db-sheet"><div class="db-sheet-status"><b>${rows.length} matching records</b><span>${rows.length>visible.length?`Showing newest ${visible.length}`:'All records shown'} · ${keys.length} columns</span></div><div class="db-sheet-scroll"><table class="db-grid"><thead><tr><th class="db-action-column">Actions</th>${keys.map(k=>`<th title="${U.esc(k)}">${U.esc(k)}</th>`).join('')}</tr></thead><tbody>${visible.map(row=>`<tr class="${row.deleted===true?'deleted-row':''} ${prefs.editingId===row.id?'selected-row':''}"><td class="db-actions db-action-column"><button class="btn small primary" data-edit-record="${U.esc(row.id)}">Edit</button>${row.deleted===true?`<button class="btn small" data-restore-record="${U.esc(row.id)}">Restore</button>`:`<button class="btn small danger" data-delete-record="${U.esc(row.id)}">Delete</button>`}<button class="btn small danger ghost-danger" data-hard-delete-record="${U.esc(row.id)}">Permanent</button></td>${keys.map(k=>`<td title="${U.esc(String(row[k] ?? '').slice(0,300))}">${U.esc(cellDisplay(k,row[k]))}</td>`).join('')}</tr>`).join('')}</tbody></table></div></section>`;
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
        ${prefs.mode === 'edit' ? '<button type="button" id="editorHardDeleteBtn" class="btn danger ghost-danger">Permanently delete</button>' : ''}
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
          <div class="card pad db-danger-zone">
            <div><span class="eyebrow">Danger zone</span><h2>Reset project data</h2><p class="muted">Permanently remove every loaded project record and discovery index before launch. Soft delete remains available for normal administration.</p></div>
            <button id="purgeDatabaseBtn" class="btn danger">Purge all project data</button>
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
    const meta = adminMeta(record);
    await global.OmniDB.put(prefs.collection, record.id, record, meta);
    await global.OmniDB.event(prefs.mode === 'edit' ? 'database_record_updated' : 'database_record_created', prefs.collection, record.id, {summary:`${prefs.mode === 'edit' ? 'Updated' : 'Created'} ${prefs.collection}/${record.id}`, vendorId:record.vendorId || ''}, meta);
    prefs.mode = 'edit';
    prefs.editingId = record.id;
    global.SuperUI.toast('Record saved to GUN', 'ok');
    rerender();
  }

  async function softDeleteRecord(id, rerender){
    if(!id) return;
    if(prefs.collection === 'users' && id === global.OmniAdminContext?.userId) return global.SuperUI.toast('You cannot delete the SuperAdmin account currently in use', 'bad');
    if(!confirm(`Delete ${prefs.collection}/${id}? This marks the record deleted and keeps an audit trail.`)) return;
    const record = collectionRows(global.OmniDB.state.cache, prefs.collection).find(row => row.id === id) || {};
    await global.OmniDB.softDelete(prefs.collection, id, adminMeta(record));
    global.SuperUI.toast('Record deleted', 'ok');
    rerender();
  }

  async function restoreRecord(id, rerender){
    if(!id) return;
    const record = collectionRows(global.OmniDB.state.cache, prefs.collection).find(row => row.id === id) || {};
    const meta = adminMeta(record);
    await global.OmniDB.patch(prefs.collection, id, {deleted:false, active:record.active === false ? true : record.active, deletedAt:''}, meta);
    await global.OmniDB.event('database_record_restored', prefs.collection, id, {summary:`Restored ${prefs.collection}/${id}`, vendorId:record.vendorId || ''}, meta);
    global.SuperUI.toast('Record restored', 'ok');
    rerender();
  }

  async function hardDeleteRecord(id, rerender){
    if(!id) return;
    if(prefs.collection === 'users' && id === global.OmniAdminContext?.userId) return global.SuperUI.toast('You cannot delete the SuperAdmin account currently in use', 'bad');
    if(!global.OmniDB.state.connectedRelays.size) return global.SuperUI.toast('Connect to the relay before permanently deleting data', 'bad');
    const confirmation = `DELETE ${prefs.collection}/${id}`;
    if(prompt(`Permanent deletion cannot be restored from the app. Type exactly:\n${confirmation}`) !== confirmation) return;
    await global.OmniDB.hardDelete(prefs.collection, id);
    if(prefs.editingId === id) {
      prefs.editingId = '';
      prefs.mode = 'create';
    }
    global.SuperUI.toast('Record permanently removed from the live graph', 'ok');
    rerender();
  }

  async function purgeDatabase(rerender){
    if(!global.OmniDB.state.connectedRelays.size) return global.SuperUI.toast('Connect to the relay before purging project data', 'bad');
    if(prompt('This removes every OMNI project record. Type exactly:\nDELETE ALL OMNI DATA') !== 'DELETE ALL OMNI DATA') return;
    const button = document.getElementById('purgeDatabaseBtn');
    if(button) { button.disabled = true; button.textContent = 'Loading every collection...'; }
    try {
      await global.OmniDB.hydrate();
      const missing = global.OmniConfig.collections.filter(name => !global.OmniDB.state.hydrated.has(name));
      if(missing.length) throw new Error(`Cannot purge until all collections load: ${missing.join(', ')}`);
      const targets = global.OmniConfig.collections.flatMap(collection => collectionRows(global.OmniDB.state.cache, collection).map(row => ({collection, id:row.id}))).filter(item => item.id);
      for(let index=0; index<targets.length; index+=12) {
        if(button) button.textContent = `Removing ${Math.min(index+12, targets.length)} of ${targets.length}...`;
        await Promise.all(targets.slice(index,index+12).map(item => global.OmniDB.hardDelete(item.collection, item.id)));
      }
      prefs.editingId = '';
      prefs.mode = 'create';
      global.SuperUI.toast(`Permanently removed ${targets.length} project record(s)`, 'ok');
      rerender();
    } catch(error) {
      global.SuperUI.toast(error.message || 'Project purge failed', 'bad');
      if(button?.isConnected) { button.disabled = false; button.textContent = 'Purge all project data'; }
    }
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
    const runAction = (action, fallback) => async () => { try { await action(); } catch(error) { global.SuperUI.toast(error.message || fallback, 'bad'); } };
    document.querySelectorAll('[data-delete-record]').forEach(btn => btn.onclick = runAction(() => softDeleteRecord(btn.dataset.deleteRecord, rerender), 'Record could not be deleted'));
    document.querySelectorAll('[data-hard-delete-record]').forEach(btn => btn.onclick = runAction(() => hardDeleteRecord(btn.dataset.hardDeleteRecord, rerender), 'Record could not be permanently deleted'));
    document.querySelectorAll('[data-restore-record]').forEach(btn => btn.onclick = runAction(() => restoreRecord(btn.dataset.restoreRecord, rerender), 'Record could not be restored'));
    document.getElementById('editorDeleteBtn')?.addEventListener('click', runAction(() => softDeleteRecord(prefs.editingId, rerender), 'Record could not be deleted'));
    document.getElementById('editorHardDeleteBtn')?.addEventListener('click', runAction(() => hardDeleteRecord(prefs.editingId, rerender), 'Record could not be permanently deleted'));
    document.getElementById('editorRestoreBtn')?.addEventListener('click', runAction(() => restoreRecord(prefs.editingId, rerender), 'Record could not be restored'));
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
        await global.OmniDB.importRows(prefs.collection, normalized, adminMeta(normalized[0] || {}));
        global.SuperUI.toast(`Imported ${normalized.length} row(s)`, 'ok');
        rerender();
      } catch(error) {
        global.SuperUI.toast(error.message || 'Import failed', 'bad');
      }
    });
    document.getElementById('purgeDatabaseBtn')?.addEventListener('click', () => purgeDatabase(rerender));
  }

  global.DatabaseBrowser = { renderDatabase, bindDatabase };
})(window);

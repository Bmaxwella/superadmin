(function(global){
  'use strict';

  const U = global.OmniUtils;

  function renderDatabase(cache){
    const selected = document.getElementById('dbCollection')?.value || 'vendors';
    const collections = global.OmniConfig.collections;
    const rows = (cache[selected] || []).filter(r => r.deleted !== true);
    const keys = [...new Set(rows.flatMap(row => Object.keys(row)))].slice(0, 24);
    return `
      <div class="card pad">
        <div class="head">
          <h2>Database Spreadsheet</h2><span class="pill ok">${U.esc(selected)}</span><div class="spacer"></div>
          <select id="dbCollection" class="input" style="width:auto">${collections.map(c=>`<option ${c===selected?'selected':''}>${c}</option>`).join('')}</select>
          <button id="exportCsvBtn" class="btn">Export CSV</button>
          <button id="exportJsonBtn" class="btn">Export JSON</button>
        </div>
        <div class="field full"><label>Import JSON rows into selected collection</label><textarea id="importJson" placeholder='[{"id":"..."}]'></textarea></div>
        <button id="importJsonBtn" class="btn primary">Import JSON</button>
      </div>
      <div class="card">${rows.length ? `<div class="table-wrap"><table class="table"><thead><tr>${keys.map(k=>`<th>${U.esc(k)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${keys.map(k=>`<td>${U.esc(String(row[k] ?? '').slice(0,140))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : '<div class="empty">No records in this collection yet</div>'}</div>`;
  }

  function bindDatabase(cache, rerender){
    const select = document.getElementById('dbCollection');
    if(select) select.onchange = rerender;
    const selected = select?.value || 'vendors';
    document.getElementById('exportCsvBtn')?.addEventListener('click', async () => {
      const rows = await global.OmniDB.exportCollection(selected);
      U.downloadText(`${selected}.csv`, U.toCsv(rows), 'text/csv');
    });
    document.getElementById('exportJsonBtn')?.addEventListener('click', async () => {
      const rows = await global.OmniDB.exportCollection(selected);
      U.downloadText(`${selected}.json`, JSON.stringify(rows, null, 2), 'application/json');
    });
    document.getElementById('importJsonBtn')?.addEventListener('click', async () => {
      const rows = U.parseJson(document.getElementById('importJson').value, null);
      if(!Array.isArray(rows)) return global.SuperUI.toast('Import must be a JSON array', 'bad');
      await global.OmniDB.importRows(selected, rows, {userId:'superadmin'});
      global.SuperUI.toast(`Imported ${rows.length} row(s)`, 'ok');
    });
  }

  global.DatabaseBrowser = { renderDatabase, bindDatabase };
})(window);

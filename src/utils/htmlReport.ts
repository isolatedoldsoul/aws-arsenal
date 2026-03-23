interface Finding {
  id: string;
  resource?: string;
  type: string;
  account: string;
  status: string;
  optimization: string;
  action: string;
}

interface Metrics {
  risk: string;
}

async function getLogoBase64(): Promise<string> {
  try {
    const res = await fetch('/Cloud_Arsenal_logo.jpeg');
    const blob = await res.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    return '';
  }
}

function buildBarChart(items: { label: string; count: number }[], max: number): string {
  return items.map(item => {
    const pct = max > 0 ? Math.round((item.count / max) * 100) : 0;
    return `
      <div class="bar-row">
        <div class="bar-label">${item.label}</div>
        <div class="bar-track">
          <div class="bar-fill" style="width:${pct}%"></div>
        </div>
        <div class="bar-count">${item.count}</div>
      </div>`;
  }).join('');
}

export async function generateHtmlReport(
  findings: Finding[],
  metrics: Metrics,
  scannerName: string,
  identity: string | null
): Promise<string> {
  const logoDataUrl = await getLogoBase64();
  const now = new Date();
  const timestamp = now.toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'medium' });
  const fileTs = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);

  // Derived KPIs from actual findings
  const totalFindings = findings.length;
  const uniqueAccounts = new Set(findings.map(f => f.account)).size;
  const uniqueTypes = new Set(findings.map(f => f.type)).size;
  const uniqueRegions = new Set(findings.map(f => (f as any).region).filter(Boolean)).size;

  const riskColor: Record<string, string> = { Low: 'c4', Medium: 'amber', High: 'red', Critical: 'red' };
  const riskClass = riskColor[metrics.risk] || 'c4';

  // Breakdowns for bar charts
  const byType: Record<string, number> = {};
  const byAccount: Record<string, number> = {};
  for (const f of findings) {
    byType[f.type] = (byType[f.type] || 0) + 1;
    byAccount[f.account] = (byAccount[f.account] || 0) + 1;
  }
  const typeItems = Object.entries(byType).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count).slice(0, 8);
  const accountItems = Object.entries(byAccount).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count).slice(0, 8);
  const maxType = Math.max(...typeItems.map(i => i.count), 1);
  const maxAccount = Math.max(...accountItems.map(i => i.count), 1);

  const rows = findings.map((f, i) => `
    <tr class="${i % 2 === 0 ? 'row-even' : 'row-odd'}">
      <td class="mono">${f.id}</td>
      <td class="sub mono">${f.resource || ''}</td>
      <td>${f.type}</td>
      <td class="mono">${f.account}</td>
      <td><span class="badge ${f.status === 'Active' || f.status === 'running' ? 'badge-ok' : 'badge-warn'}">${f.status}</span></td>
      <td class="sub">${f.optimization}</td>
    </tr>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Cloud Arsenal — ${scannerName} Report</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #e8f0f6; color: #21295C; font-size: 13px; }

  /* Header — darkest navy #21295C → deep navy #1B3B6F */
  .hdr { background: linear-gradient(135deg, #21295C 0%, #1B3B6F 100%); color: #fff; padding: 28px 40px 0; }
  .hdr-top { display: flex; align-items: center; gap: 20px; padding-bottom: 20px; }
  .hdr-logo { height: 48px; object-fit: contain; }
  .hdr-title { flex: 1; }
  .hdr-title h1 { font-size: 22px; font-weight: 800; letter-spacing: -0.5px; color: #f0f6ff; }
  .hdr-title .sub { font-size: 12px; color: #7ab4cc; margin-top: 3px; }
  .hdr-meta { text-align: right; font-size: 11px; color: #5a94ac; line-height: 1.8; }
  .hdr-bar { height: 4px; background: linear-gradient(90deg, #065A82, #1C7293); margin-top: 20px; }

  /* KPI Cards — one per palette color */
  .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; padding: 24px 40px; }
  .kpi { background: #fff; border-radius: 12px; padding: 20px; border-top: 3px solid; box-shadow: 0 2px 8px rgba(33,41,92,.10); }
  .kpi.c1 { border-color: #21295C; }
  .kpi.c2 { border-color: #1B3B6F; }
  .kpi.c3 { border-color: #065A82; }
  .kpi.c4 { border-color: #1C7293; }
  .kpi.red   { border-color: #b91c1c; }
  .kpi.amber { border-color: #b45309; }
  .kpi-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #065A82; }
  .kpi-value { font-size: 32px; font-weight: 800; margin: 6px 0 2px; color: #21295C; }
  .kpi-value.teal  { color: #1C7293; }
  .kpi-value.red   { color: #b91c1c; }
  .kpi-value.amber { color: #b45309; }
  .kpi-sub { font-size: 11px; color: #7ab4cc; }

  /* Summary banner — #1B3B6F → #065A82, left stripe #1C7293 */
  .banner { margin: 0 40px 24px; background: linear-gradient(135deg, #1B3B6F 0%, #065A82 100%); border-radius: 12px; padding: 20px 28px; color: #fff; display: flex; align-items: center; justify-content: space-between; border-left: 4px solid #1C7293; }
  .banner-text h2 { font-size: 18px; font-weight: 800; color: #f0f6ff; }
  .banner-text p  { font-size: 12px; color: #7ab4cc; margin-top: 4px; }
  .banner-stat { text-align: right; }
  .banner-stat .num { font-size: 36px; font-weight: 900; color: #a8d8ea; }
  .banner-stat .lbl { font-size: 11px; color: #7ab4cc; }

  /* Bar charts */
  .charts { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; padding: 0 40px 24px; }
  .card { background: #fff; border-radius: 12px; padding: 20px; box-shadow: 0 2px 8px rgba(33,41,92,.10); }
  .card h3 { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #065A82; margin-bottom: 16px; border-bottom: 1px solid #c5dce8; padding-bottom: 10px; }
  .bar-row { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
  .bar-label { font-size: 11px; width: 140px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: #1B3B6F; }
  .bar-track { flex: 1; background: #cde0ec; border-radius: 4px; height: 8px; overflow: hidden; }
  .bar-fill  { height: 100%; background: linear-gradient(90deg, #065A82, #1C7293); border-radius: 4px; }
  .bar-count { font-size: 11px; font-weight: 700; color: #21295C; width: 28px; text-align: right; }

  /* Table */
  .tbl-wrap { margin: 0 40px 24px; background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(33,41,92,.10); }
  .tbl-header { padding: 16px 20px; background: #eef5fa; border-bottom: 1px solid #c5dce8; display: flex; align-items: center; gap: 8px; }
  .tbl-header h3 { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #1B3B6F; }
  .tbl-header .count { margin-left: auto; font-size: 11px; color: #065A82; font-weight: 600; background: #cde0ec; padding: 2px 10px; border-radius: 99px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { padding: 10px 14px; text-align: left; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #065A82; background: #eef5fa; border-bottom: 2px solid #c5dce8; }
  td { padding: 10px 14px; vertical-align: top; border-bottom: 1px solid #e8f2f8; }
  .row-even { background: #fff; }
  .row-odd  { background: #f5fafd; }
  tr:hover td { background: #e2eff8; }
  .mono { font-family: 'SF Mono', 'Fira Code', monospace; font-size: 11px; color: #1B3B6F; }
  .sub  { color: #1C7293; }
  .badge { display: inline-block; font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; padding: 2px 8px; border-radius: 99px; border: 1px solid; }
  .badge-ok   { background: #cde0ec; color: #065A82; border-color: #a8cfe0; }
  .badge-warn { background: #fee2e2; color: #b91c1c; border-color: #ffc9c9; }

  /* Footer */
  .footer { margin: 0 40px 32px; padding: 16px 20px; background: #fff; border-radius: 12px; border: 1px solid #c5dce8; display: flex; align-items: center; justify-content: space-between; }
  .footer p { font-size: 11px; color: #7ab4cc; }
  .footer .brand { font-size: 11px; font-weight: 700; color: #1C7293; letter-spacing: 0.5px; }

  @media print {
    body { background: #fff; }
    .hdr { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .kpi, .card, .tbl-wrap, .banner, .footer { box-shadow: none; }
  }
</style>
</head>
<body>

<!-- Header -->
<div class="hdr">
  <div class="hdr-top">
    ${logoDataUrl ? `<img class="hdr-logo" src="${logoDataUrl}" alt="Cloud Arsenal"/>` : ''}
    <div class="hdr-title">
      <h1>${scannerName} — Scan Report</h1>
      <div class="sub">${identity ? `Identity: ${identity}` : ''} &nbsp;·&nbsp; Read-only analysis &nbsp;·&nbsp; No resources were modified</div>
    </div>
    <div class="hdr-meta">
      Generated: ${timestamp}<br/>
      Total Findings: ${totalFindings}<br/>
      Risk Level: ${metrics.risk}
    </div>
  </div>
  <div class="hdr-bar"></div>
</div>

<!-- KPI Cards -->
<div class="kpi-grid">
  <div class="kpi c1">
    <div class="kpi-label">Total Findings</div>
    <div class="kpi-value">${totalFindings}</div>
    <div class="kpi-sub">Resources flagged</div>
  </div>
  <div class="kpi c2">
    <div class="kpi-label">Accounts Affected</div>
    <div class="kpi-value">${uniqueAccounts}</div>
    <div class="kpi-sub">Unique AWS accounts</div>
  </div>
  <div class="kpi c3">
    <div class="kpi-label">Resource Types</div>
    <div class="kpi-value">${uniqueTypes}</div>
    <div class="kpi-sub">Distinct types found</div>
  </div>
  <div class="kpi c4">
    <div class="kpi-label">Regions</div>
    <div class="kpi-value">${uniqueRegions || '—'}</div>
    <div class="kpi-sub">AWS regions scanned</div>
  </div>
</div>

<!-- Summary Banner -->
<div class="banner">
  <div class="banner-text">
    <h2>Scan Summary — ${scannerName}</h2>
    <p>Generated ${timestamp}</p>
  </div>
  <div class="banner-stat">
    <div class="num">${totalFindings}</div>
    <div class="lbl">Total Findings</div>
  </div>
</div>

<!-- Bar Charts -->
<div class="charts">
  <div class="card">
    <h3>Findings by Resource Type</h3>
    ${typeItems.length ? buildBarChart(typeItems, maxType) : '<p style="color:#94a3b8;font-size:12px">No data</p>'}
  </div>
  <div class="card">
    <h3>Findings by Account</h3>
    ${accountItems.length ? buildBarChart(accountItems, maxAccount) : '<p style="color:#94a3b8;font-size:12px">No data</p>'}
  </div>
</div>

<!-- Findings Table -->
<div class="tbl-wrap">
  <div class="tbl-header">
    <h3>Resource Inventory</h3>
    <span class="count">${findings.length} findings</span>
  </div>
  <table>
    <thead>
      <tr>
        <th>Resource ID</th>
        <th>Resource Name</th>
        <th>Type</th>
        <th>Account</th>
        <th>Status</th>
        <th>Optimization</th>
      </tr>
    </thead>
    <tbody>
      ${rows || '<tr><td colspan="6" style="text-align:center;padding:32px;color:#94a3b8">No findings</td></tr>'}
    </tbody>
  </table>
</div>

<!-- Footer -->
<div class="footer">
  <p>Read-only analysis. No resources were modified during this scan.</p>
  <span class="brand">Cloud Arsenal</span>
</div>

</body>
</html>`;
}

export function triggerHtmlDownload(html: string, scannerName: string): void {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `CloudArsenal_${scannerName.replace(/\s+/g, '_')}_${ts}.html`;
  const blob = new Blob([html], { type: 'text/html;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

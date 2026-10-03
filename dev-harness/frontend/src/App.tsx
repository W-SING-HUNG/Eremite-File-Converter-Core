import { useState, useEffect } from 'react';

const LEGAL: Record<string, string[]> = {
  docx: ['pdf'], xlsx: ['pdf'], pptx: ['pdf'],
  markdown: ['html', 'docx'], html: ['markdown'],
  png: ['jpeg', 'webp', 'avif'],
  jpeg: ['png', 'webp', 'avif'],
  webp: ['png', 'jpeg', 'avif'],
  avif: ['png', 'jpeg', 'webp'],
};

const IMAGE_KINDS = new Set(['png', 'jpeg', 'webp', 'avif']);
const OFFICE_KINDS = new Set(['docx', 'xlsx', 'pptx']);
const STRUCTURED_KINDS = new Set(['markdown', 'html']);

function profilesFor(kind: string | undefined): Array<{ value: string; label: string }> {
  if (!kind) return [];
  if (IMAGE_KINDS.has(kind)) return [
    { value: 'balanced', label: 'balanced' },
    { value: 'high_quality', label: 'high_quality' },
    { value: 'lossless', label: 'lossless' },
  ];
  if (OFFICE_KINDS.has(kind)) return [
    { value: 'standard', label: 'standard' },
    { value: 'high_quality', label: 'high_quality' },
  ];
  if (STRUCTURED_KINDS.has(kind)) return [{ value: 'standard', label: 'standard (semantic)' }];
  return [];
}

async function call(token: string, route: string, body?: unknown): Promise<any> {
  const res = await fetch(`/api${route}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', 'x-qa-token': token },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

export function App() {
  const [token, setToken] = useState(localStorage.getItem('qa-token') ?? '');
  const [sourcePath, setSourcePath] = useState('');
  const [outDir, setOutDir] = useState('');
  const [target, setTarget] = useState('');
  const [profile, setProfile] = useState('balanced');
  const [conflict, setConflict] = useState<'reject' | 'version'>('reject');
  const [flattenBg, setFlattenBg] = useState('#ffffff');
  const [metadataPolicy, setMetadataPolicy] = useState<'strip' | 'keep-copyright'>('strip');
  const [detected, setDetected] = useState<any>(null);
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  const saveToken = (v: string) => { setToken(v); localStorage.setItem('qa-token', v); };
  const kind: string | undefined = detected?.kind && detected.kind !== 'unknown' ? detected.kind : undefined;
  const targets = kind ? LEGAL[kind]?.filter((t) => t !== kind) ?? [] : [];
  const isImage = kind ? IMAGE_KINDS.has(kind) : false;
  const profileOptions = profilesFor(kind);

  // Keep the selected profile legal for the detected family.
  useEffect(() => {
    if (profileOptions.length && !profileOptions.some((p) => p.value === profile)) {
      setProfile(profileOptions[0]!.value);
    }
    if (kind) setTarget((t) => (LEGAL[kind]?.includes(t) ? t : ''));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  const detect = async () => {
    setBusy(true); setResult(null);
    try { setDetected(await call(token, '/detect', { sourcePath })); }
    finally { setBusy(false); }
  };
  const convert = async () => {
    setBusy(true);
    try {
      const body: any = {
        sourcePath, targetFormat: target, profile,
        output: { directory: outDir, conflict },
      };
      if (isImage) {
        body.imageOptions = { flattenBackground: flattenBg, metadata: metadataPolicy };
      }
      setResult(await call(token, '/convert', body));
    } finally { setBusy(false); }
  };

  const openOutput = async (what: 'file' | 'dir') => {
    if (result?.status !== 'succeeded' || !result.output?.path) return;
    const target = what === 'file' ? result.output.path : outDir || result.output.path.replace(/[\\/][^\\/]+$/, '');
    await call(token, '/open', { what, target });
  };
  const openOutputClipboard = () => {
    if (result?.status === 'succeeded' && result.output?.path) navigator.clipboard?.writeText(result.output.path);
  };

  return (
    <div className="qa-shell">
      <div className="qa-banner">DEV/QA ONLY — not Eremite UI · file-converter-core harness (Sharp image + Pandoc structured + LibreOffice Office→PDF)</div>
      <h1>File Converter Tool Core · QA Harness</h1>

      <section>
        <label>QA token（backend 启动时输出）
          <input value={token} onChange={(e) => saveToken(e.target.value)} placeholder="x-qa-token" />
        </label>
      </section>

      <section>
        <h2>1. 输入文件（绝对路径）</h2>
        <div className="row">
          <input className="path" value={sourcePath} onChange={(e) => setSourcePath(e.target.value)} placeholder="D:\path\to\input.docx / .png / .md ..." />
          <button disabled={busy || !sourcePath} onClick={detect}>检测真实类型</button>
        </div>
        {detected && (
          <pre className="card">{JSON.stringify(detected, null, 2)}</pre>
        )}
      </section>

      <section>
        <h2>2. 转换参数（仅显示合法目标）</h2>
        <div className="row">
          <label>目标
            <select value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">—</option>
              {targets.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label>profile
            <select value={profile} onChange={(e) => setProfile(e.target.value)}>
              {profileOptions.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </label>
          <label>冲突
            <select value={conflict} onChange={(e) => setConflict(e.target.value as 'reject' | 'version')}>
              <option value="reject">reject</option><option value="version">version</option>
            </select>
          </label>
        </div>
        {isImage && (
          <div className="row" style={{ marginTop: 8 }}>
            <label>JPEG flatten background
              <input type="color" value={flattenBg} onChange={(e) => setFlattenBg(e.target.value)} />
            </label>
            <label>metadata
              <select value={metadataPolicy} onChange={(e) => setMetadataPolicy(e.target.value as 'strip' | 'keep-copyright')}>
                <option value="strip">strip (默认)</option>
                <option value="keep-copyright">keep-copyright</option>
              </select>
            </label>
          </div>
        )}
        <div className="row">
          <input className="path" value={outDir} onChange={(e) => setOutDir(e.target.value)} placeholder="输出目录（绝对路径）" />
          <button disabled={busy || !target || !outDir} onClick={convert}>执行转换</button>
        </div>
        <p className="hint">图片走 Sharp/libvips；Markdown/HTML/DOCX 走 sandboxed Pandoc（semantic-standalone，嵌入资源会被提前拒绝）；DOCX/XLSX/PPTX→PDF 走 LibreOffice headless（独立 profile + 显式 infilter，Phase 5 前为 fallback 引擎）。</p>
      </section>

      {result && (
        <section>
          <h2>3. 结果</h2>
          {result.status === 'succeeded' && (
            <div className="card result-succeeded" style={{ marginBottom: 8 }}>
              <div><strong>输出：</strong><code>{result.output.path}</code></div>
              <div><strong>大小：</strong>{result.output.sizeBytes} bytes · <strong>SHA-256：</strong><code>{result.output.sha256?.slice(0, 16)}…</code></div>
              <div><strong>引擎：</strong>{result.engine?.actual} v{result.engine?.actualVersion} {result.engine?.fallbackUsed ? '(fallback)' : ''}</div>
              <div><strong>验证器：</strong>{result.validation?.validator} — {result.validation?.passed ? 'PASS' : 'FAIL'} ({result.validation?.checks?.filter((c: any) => !c.passed).length ?? 0} failures)</div>
              {result.warnings?.length > 0 && (
                <div><strong>Warnings ({result.warnings.length}):</strong>
                  <ul>{result.warnings.map((w: any, i: number) => <li key={i}><code>{w.code}</code> — {w.message}</li>)}</ul>
                </div>
              )}
              <div className="row" style={{ marginTop: 4 }}>
                <button onClick={() => openOutput('file')}>打开输出文件</button>
                <button onClick={() => openOutput('dir')}>打开输出目录</button>
                <button onClick={openOutputClipboard}>复制输出路径</button>
              </div>
            </div>
          )}
          <pre className={'card result-' + result.status}>{JSON.stringify(result, null, 2)}</pre>
        </section>
      )}
    </div>
  );
}

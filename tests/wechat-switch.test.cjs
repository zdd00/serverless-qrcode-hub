const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const root = path.join(__dirname, '..');
const workerSource = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'dist/admin.html'), 'utf8');

function workerWithMapping(mapping) {
  const context = vm.createContext({ URL, console, mapping: { ...mapping } });
  vm.runInContext(workerSource.replace('export default {', 'globalThis.worker = {') + `
    getMappingByPath = async () => mapping;
    ensurePathAvailable = async () => {};
    DB = { prepare() { return { bind(...values) { return { async run() {
      mapping = { ...mapping, path: values[0], target: values[1],
        isWechat: Boolean(values[5]), qrCodeData: values[6] };
    } }; } }; } };
    globalThis.update = updateMapping;
    globalThis.normalize = normalizeMappingPayload;
  `, context);
  return context;
}

const original = {
  path: 'group', name: 'Group', target: 'https://example.com',
  isWechat: true, qrCodeData: 'data:image/png;base64,aGVsbG8=',
};

test('turning WeChat off and on preserves the stored QR image', async () => {
  const context = workerWithMapping(original);
  const disabled = await context.update({ ...original, originalPath: 'group', isWechat: false, qrCodeData: null });
  assert.equal(disabled.isWechat, false);
  assert.equal(disabled.qrCodeData, original.qrCodeData);
  const enabled = await context.update({ ...original, originalPath: 'group', qrCodeData: null });
  assert.equal(enabled.isWechat, true);
  assert.equal(enabled.qrCodeData, original.qrCodeData);
});

test('a short link can retain an uploaded QR image for later WeChat mode', () => {
  const context = workerWithMapping(original);
  assert.equal(context.normalize({ ...original, isWechat: false }).qrCodeData, original.qrCodeData);
});

test('enabling WeChat without an uploaded or stored image still fails clearly', async () => {
  const context = workerWithMapping({ ...original, isWechat: false, qrCodeData: null });
  await assert.rejects(context.update({ ...original, originalPath: 'group', qrCodeData: null }), /微信二维码必须提供原始二维码数据/);
});

test('validation feedback is placed inside the open modal, not behind it', () => {
  const source = html.slice(html.indexOf('    function showAlert('), html.indexOf('    async function request('));
  let displayed;
  const feedback = { replaceChildren(alert) { displayed = alert; } };
  const context = {
    document: {
      createElement: () => ({ scrollIntoView() {}, style: {} }),
      querySelector: () => ({ querySelector: () => feedback }),
    },
    elements: { alertContainer: { appendChild() { assert.fail('Feedback is outside the dialog'); } } },
    escapeHtml: value => value,
    setTimeout() {},
  };
  vm.runInNewContext(source + "showAlert('请先上传微信群二维码');", context);
  assert.match(displayed.innerHTML, /请先上传微信群二维码/);
});

test('all inline frontend scripts parse', () => {
  for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) {
    new vm.Script(match[1]);
  }
});

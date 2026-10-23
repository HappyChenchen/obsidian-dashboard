import test from 'node:test';
import assert from 'node:assert/strict';
import {lib, fixture, elements} from './helpers.mjs';
const date = '2026-10-12';
async function setup() {
  const {plugin} = fixture('');
  plugin.settings.monthlyPlan['2026-10-15'] = 'Walk #运动 #生活';
  const view = new lib.DashboardView({}, plugin);
  view.activeTab = 'monthly'; view.monthlyPlan.month = '2026-10';
  await view.render();
  const input = view.monthlyPlan.editDate(date);
  const list = () => elements(view.containerEl).find((el) => el.attrs.id === input.attrs['aria-controls']);
  const type = (value, cursor = value.length) => {input.value = value; input.setSelectionRange(cursor, cursor); input.handlers.input();};
  return {plugin, view, input, list, type};
}
function key(input, name, extras = {}) {
  let prevented = false;
  input.handlers.keydown({key: name, preventDefault() {prevented = true;}, stopPropagation() {}, ...extras});
  return prevented;
}

test('suggestions open above an editor near the bottom of the window', async () => {
  const {input, list, type} = await setup();
  input.getBoundingClientRect = () => ({top: 680, bottom: 780});
  type('Read #');
  assert.equal(list().style.top, 'auto');
  assert.equal(list().style.maxHeight, '180px');
  input.getBoundingClientRect = () => ({top: 100, bottom: 200});
  type('Read #');
  assert.equal(list().style.bottom, 'auto');
  assert.equal(list().style.top, '104px');
});

test('hash offers configured and previously used tags; keyboard choice inserts and saves one tag', async () => {
  const {plugin, input, list, type} = await setup();
  type('Read #');
  assert.equal(list().hidden, false);
  assert.deepEqual(list().children.map((el) => el.text), ['#生活', '#工作', '#学习', '#其他', '#运动']);
  assert.equal(key(input, 'ArrowDown'), true);
  assert.equal(key(input, 'Enter'), true);
  assert.equal(input.value, 'Read #工作 ');
  assert.equal(list().hidden, true);
  await input.handlers.blur();
  assert.equal(plugin.settings.monthlyPlan[date], 'Read #工作');
});

test('partial tags replace the whole token, keep surrounding text, and exclude tags already present', async () => {
  const {input, list, type} = await setup();
  type('Read #学习 then #');
  assert.equal(list().children.some((el) => el.text === '#学习'), false);
  type('Read #学旧 afterward', 'Read #学'.length);
  assert.deepEqual(list().children.map((el) => el.text), ['#学习']);
  let prevented = false;
  list().children[0].handlers.mousedown({preventDefault() {prevented = true;}});
  assert.equal(prevented, true);
  list().children[0].handlers.click();
  assert.equal(input.value, 'Read #学习 afterward');
  assert.equal(input.selectionStart, 'Read #学习 '.length);
  type('阅读#学');
  list().children[0].handlers.click();
  assert.equal(input.value, '阅读 #学习 ');
});

test('unknown tags, URL fragments, selected text and IME do not intercept normal input', async () => {
  const {input, list, type} = await setup();
  for (const text of ['Read #自定义', 'https://example.com/#', '##']) {
    type(text); assert.equal(list().hidden, true);
    assert.equal(key(input, 'Enter'), false);
  }
  type('Read #'); input.setSelectionRange(0, 6); input.handlers.click();
  assert.equal(list().hidden, true);
  type('Read #'); input.handlers.compositionstart();
  assert.equal(list().hidden, true);
  type('Read #学'); assert.equal(list().hidden, true);
  assert.equal(key(input, 'Enter', {isComposing: true}), false);
  input.handlers.compositionend();
  assert.equal(list().hidden, false);
  assert.deepEqual(list().children.map((el) => el.text), ['#学习']);
  assert.equal(key(input, 'Enter', {shiftKey: true}), false);
});

test('refresh preserves candidate selection and Escape dismissal; a new query reopens suggestions', async () => {
  const {view, input, type} = await setup();
  type('Read #'); key(input, 'ArrowDown');
  await view.render();
  const restored = view.monthlyPlan.editDate(date);
  restored.setSelectionRange(restored.value.length, restored.value.length);
  view.monthlyPlan.updateTagSuggestions(date);
  let list = elements(view.containerEl).find((el) => el.attrs.id === restored.attrs['aria-controls']);
  assert.equal(list.children.find((el) => el.attrs['aria-selected'] === 'true').text, '#工作');
  assert.equal(key(restored, 'Escape'), true);
  view.monthlyPlan.updateTagSuggestions(date);
  assert.equal(list.hidden, true);
  restored.value = 'Read #学'; restored.setSelectionRange(restored.value.length, restored.value.length); restored.handlers.input();
  assert.equal(list.hidden, false);
  await restored.handlers.blur();
  assert.equal(list.hidden, true);
});

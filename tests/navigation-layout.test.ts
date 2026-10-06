import assert from 'node:assert/strict';
import test from 'node:test';
import { navigationLayout, navigationSection } from '../src/components/scene/navigation-layout.ts';

const content = {
  name: 'Furkan Akpınar', callLabel: 'İletişime geç',
  nav: [
    { label: 'Ana Sayfa', target: 'hero' },
    { label: 'Projeler', target: 'projects' },
    { label: 'Hakkımda', target: 'about-us' },
    { label: 'İletişim', target: 'contact' },
  ],
};
const measure = (text: string, font: string) => text.length * Number(font.match(/([\d.]+)px/)![1]) * 0.49;

test('desktop navigation controls contain the exact canvas text positions without overlapping', () => {
  for (const width of [900, 1100, 1440, 1920]) {
    const layout = navigationLayout(width, measure, content);
    assert.equal(layout.compact, false);
    assert.ok(layout.logo.x + layout.logo.width < layout.links[0].bounds.x);
    for (let index = 0; index < layout.links.length; index++) {
      const item = layout.links[index];
      assert.ok(item.textX >= item.bounds.x);
      assert.ok(item.textX + measure(item.label, layout.font) <= item.bounds.x + item.bounds.width);
      assert.ok(item.baseline > item.bounds.y && item.baseline < item.bounds.y + item.bounds.height);
      assert.ok(item.bounds.height >= 44);
      if (index > 0) assert.ok(layout.links[index - 1].bounds.x + layout.links[index - 1].bounds.width < item.bounds.x);
    }
    const last = layout.links.at(-1)!.bounds;
    assert.ok(last.x + last.width < layout.call.bounds.x);
    assert.ok(layout.call.bounds.x + layout.call.bounds.width <= width);
  }
});

test('phone and tablet dropdown stay on-screen with four full touch rows', () => {
  for (const width of [320, 390, 768, 899]) {
    const layout = navigationLayout(width, measure, content);
    assert.equal(layout.compact, true);
    assert.ok(layout.popup.x >= 0);
    assert.ok(layout.popup.x + layout.popup.width <= width);
    assert.ok(layout.popup.y > layout.height);
    assert.equal(layout.links.length, 4);
    layout.links.forEach((item, index) => {
      assert.equal(item.bounds.y, layout.popup.y + 46 * index);
      assert.equal(item.bounds.x, layout.popup.x);
      assert.ok(item.bounds.height >= 44);
    });
  }
});

test('the blue page and its legacy navigation IDs select Contact', () => {
  assert.equal(navigationSection('hero'), 'hero');
  assert.equal(navigationSection('projects'), 'projects');
  assert.equal(navigationSection('about-us'), 'about-us');
  assert.equal(navigationSection('office'), 'about-us');
  assert.equal(navigationSection('golden-tie-reveal'), 'contact');
  assert.equal(navigationSection('golden-tie'), 'contact');
  assert.equal(navigationSection('contact'), 'contact');
});

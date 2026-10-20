import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { blocks, isTableStart, splitTableRow } from './markdown-blocks';

const html = (src: string, names: string[] = []) => renderToStaticMarkup(<>{blocks(src, names)}</>);

describe('GFM tables', () => {
  it('renders header, separator and body rows as a table', () => {
    const out = html('| Name | Role |\n| --- | --- |\n| Ana | Admin |\n| Bob | Member |');
    expect(out).toContain('<div class="md-table-wrap"><table>');
    expect(out).toContain('<thead><tr><th>Name</th><th>Role</th></tr></thead>');
    expect(out).toContain('<tbody><tr><td>Ana</td><td>Admin</td></tr>');
    expect(out).toContain('<tr><td>Bob</td><td>Member</td></tr></tbody>');
    expect(out).not.toContain('|');
  });

  it('applies column alignment from the separator row', () => {
    const out = html('| L | C | R | D |\n|:---|:---:|---:|---|\n| 1 | 2 | 3 | 4 |');
    expect(out).toContain('<th style="text-align:left">L</th>');
    expect(out).toContain('<th style="text-align:center">C</th>');
    expect(out).toContain('<th style="text-align:right">R</th>');
    expect(out).toContain('<th>D</th>');
    expect(out).toContain('<td style="text-align:right">3</td>');
  });

  it('accepts rows without outer pipes', () => {
    const out = html('a | b\n--|--\n1 | 2');
    expect(out).toContain('<th>a</th><th>b</th>');
    expect(out).toContain('<td>1</td><td>2</td>');
  });

  it('escapes HTML in cells instead of injecting it', () => {
    const out = html('| x |\n| --- |\n| <img src=x onerror=alert(1)> |');
    expect(out).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(out).not.toContain('<img');
  });

  it('keeps inline markdown (bold, code, mentions) inside cells', () => {
    const out = html('| a | b |\n| - | - |\n| **bold** | `x\\|y` |\n| @ana | z |', ['ana']);
    expect(out).toContain('<td><b>bold</b></td>');
    expect(out).toContain('<td><code>x|y</code></td>');
    expect(out).toContain('<span class="mention">@ana</span>');
  });

  it('honours escaped pipes inside a cell', () => {
    expect(splitTableRow('| a \\| b | c |')).toEqual(['a | b', 'c']);
    const out = html('| h |\n| - |\n| a \\| b |');
    expect(out).toContain('<td>a | b</td>');
  });

  it('pads short body rows and truncates long ones to the header width', () => {
    const out = html('| a | b |\n| - | - |\n| 1 |\n| 1 | 2 | 3 |');
    expect(out).toContain('<tr><td>1</td><td></td></tr>');
    expect(out).toContain('<tr><td>1</td><td>2</td></tr>');
    expect(out).not.toContain('>3<');
  });

  it('ends the table at a blank line and keeps following text as a paragraph', () => {
    const out = html('| a |\n| - |\n| 1 |\n\nAfter table');
    expect(out).toContain('<p>After table</p>');
    expect(out.match(/<tr>/g)).toHaveLength(2);
  });

  it('starts a table directly after a paragraph line', () => {
    const out = html('Intro\n| a | b |\n| - | - |\n| 1 | 2 |');
    expect(out).toContain('<p>Intro</p>');
    expect(out).toContain('<table>');
  });

  it('does not treat a lone pipe line or mismatched columns as a table', () => {
    expect(isTableStart(['a | b', '--- | --- | ---'], 0)).toBe(false);
    expect(isTableStart(['just text | here'], 0)).toBe(false);
    expect(html('a | b\nc | d')).not.toContain('<table>');
  });
});

describe('headings option (skill preview)', () => {
  const src = 'intro\n# One\n###### Six\n####### seven\n#nospace\ntext **b**';
  it('renders # lines as h3-h6 with inline formatting and ends the paragraph', () => {
    const out = html('para\n## Use `x`\nmore\n# Top', []);
    expect(out).not.toContain('<h');
    const withH = renderToStaticMarkup(<>{blocks('para\n## Use `x`\nmore\n# Top', [], true)}</>);
    expect(withH).toContain('<p>para</p>');
    expect(withH).toContain('<h4>Use <code>x</code></h4>');
    expect(withH).toContain('<p>more</p>');
    expect(withH).toContain('<h3>Top</h3>');
  });
  it('caps at h6 and needs a space and a title', () => {
    const out = renderToStaticMarkup(<>{blocks(src, [], true)}</>);
    expect(out).toContain('<h3>One</h3>');
    expect(out).toContain('<h6>Six</h6>');
    expect(out).not.toContain('<h6>seven');
    expect(out).toContain('####### seven');
    expect(out).toContain('#nospace');
  });
  it('leaves chat rendering unchanged', () => {
    expect(html('# One\ntext')).toBe('<p># One<br/>text</p>');
  });
});

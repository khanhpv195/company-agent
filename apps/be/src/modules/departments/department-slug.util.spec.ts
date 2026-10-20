import { departmentRoomSlug, firstFreeRoomName } from './department-slug.util';

describe('departmentRoomSlug', () => {
  it.each([
    ['Kinh doanh', 'kinh-doanh'],
    ['Kế toán', 'ke-toan'],
    ['Đào tạo & Phát triển', 'dao-tao-phat-trien'],
    ['  Nhân sự  ', 'nhan-su'],
    ['R&D 2', 'r-d-2'],
    ['!!!', 'phong-ban'],
    ['', 'phong-ban'],
  ])('%s -> %s', (input, expected) => {
    expect(departmentRoomSlug(input)).toBe(expected);
  });
});

describe('firstFreeRoomName', () => {
  it('keeps a free slug', () => {
    expect(firstFreeRoomName('kinh-doanh', new Set(['marketing']))).toBe('kinh-doanh');
  });

  it('appends -2, -3... on collision', () => {
    expect(firstFreeRoomName('kinh-doanh', new Set(['kinh-doanh']))).toBe('kinh-doanh-2');
    expect(firstFreeRoomName('kinh-doanh', new Set(['kinh-doanh', 'kinh-doanh-2']))).toBe(
      'kinh-doanh-3',
    );
  });
});

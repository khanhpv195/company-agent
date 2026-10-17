import type { Connection, ConnectionProvider } from '@repo/shared';

/** What a provider is, independent of any workspace (copied from the desktop app's fixtures). */
export type ConnectionDefinition = Pick<
  Connection,
  | 'id'
  | 'name'
  | 'shortName'
  | 'color'
  | 'description'
  | 'capabilities'
  | 'permissions'
  | 'accountLabel'
  | 'accounts'
> & {
  /** Room created on connect when the caller gives no name. */
  roomName: string;
};

/** The simulated first conversation a fresh connection brings into its room. */
export interface ConnectionSample {
  /** Name of the external sender (also the thread name). */
  from: string;
  text: string;
  /** The agent's draft reply. */
  reply: string;
}

/** In catalog order, which is the order of `GET /connections`. */
export const CONNECTION_CATALOG: readonly ConnectionDefinition[] = [
  {
    id: 'zalo',
    name: 'Zalo OA',
    shortName: 'Zalo',
    color: '#0068ff',
    roomName: 'zalo-inbox',
    description:
      'Nhận tin nhắn gửi tới Official Account. Agent đọc, soạn trả lời và gửi lại khách trên Zalo.',
    capabilities: ['Tin nhắn OA', 'Trả lời khách', 'Người quan tâm'],
    permissions: [
      'Đọc tin nhắn gửi tới Official Account',
      'Gửi tin nhắn trả lời thay OA',
      'Xem tên và ảnh đại diện người quan tâm',
    ],
    accountLabel: 'Official Account',
    accounts: [
      { name: 'Holatech OA', detail: '1.240 người quan tâm' },
      { name: 'Hola Shop', detail: '386 người quan tâm' },
    ],
  },
  {
    id: 'facebook',
    name: 'Facebook Messenger',
    shortName: 'Facebook',
    color: '#1877f2',
    roomName: 'facebook-inbox',
    description: 'Nối Fanpage để agent xử lý inbox Messenger và comment dưới bài viết.',
    capabilities: ['Messenger', 'Comment', 'Trả lời khách'],
    permissions: [
      'Đọc tin nhắn Messenger của Page',
      'Trả lời tin nhắn và comment',
      'Xem thông tin công khai của Page',
    ],
    accountLabel: 'Fanpage',
    accounts: [
      { name: 'Holatech', detail: 'Page · 5,2K người theo dõi' },
      { name: 'Hola Shop', detail: 'Page · 820 người theo dõi' },
    ],
  },
  {
    id: 'gmail',
    name: 'Gmail',
    shortName: 'Google',
    color: '#ea4335',
    roomName: 'gmail-inbox',
    description:
      'Agent đọc email mới, tóm tắt, gắn nhãn và soạn nháp trả lời. Chỉ gửi khi bạn cho phép.',
    capabilities: ['Đọc email', 'Soạn nháp', 'Gửi', 'Nhãn'],
    permissions: [
      'Đọc email trong hộp thư đến',
      'Tạo bản nháp trả lời',
      'Gửi email khi bạn cho phép',
      'Thêm và gỡ nhãn',
    ],
    accountLabel: 'hộp thư',
    accounts: [{ name: 'khanhpv@holatech.tech', detail: 'Google Workspace' }],
  },
];

export const CONNECTION_SAMPLES: Record<ConnectionProvider, ConnectionSample> = {
  zalo: {
    from: 'Nguyễn Lan',
    text: 'Shop ơi áo polo size M còn màu trắng không ạ? Ship về Đà Nẵng mất mấy ngày?',
    reply:
      'Dạ chào chị Lan, áo polo size M màu trắng bên em **còn 6 chiếc** ạ. Ship về Đà Nẵng khoảng **2–3 ngày**, đơn từ 300k được miễn phí ship. Chị muốn em giữ hàng luôn không ạ?',
  },
  facebook: {
    from: 'Trần Huy',
    text: 'Cho mình hỏi gói Pro giá bao nhiêu, có dùng thử không?',
    reply:
      'Chào anh Huy, gói Pro là **$20/tháng** và có **14 ngày dùng thử miễn phí**, không cần thẻ. Em gửi anh link đăng ký nhé?',
  },
  gmail: {
    from: 'Phòng kế toán',
    text: '**Re: Hoá đơn tháng 9**\nAnh gửi giúp em bản xác nhận thanh toán AWS tháng 9 trước thứ Sáu nhé.',
    reply:
      'Em đã tìm thấy email hoá đơn AWS tháng 9 (**$412,80**) và soạn nháp trả lời kèm file PDF. Anh xem rồi bấm gửi giúp em.',
  },
};

export const findDefinition = (id: string): ConnectionDefinition | undefined =>
  CONNECTION_CATALOG.find((definition) => definition.id === id);

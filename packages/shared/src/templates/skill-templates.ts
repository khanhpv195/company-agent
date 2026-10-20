export interface SkillTemplate {
  id: string;
  slug: string;
  name: string;
  description: string;
  content: string;
}

const CHUNG_KHONG_GUI = `Chỉ soạn nháp. Không gửi tin, email hay bài đăng khi chưa có người duyệt.`;

const KHONG_BIA_SU_THAT = `Không tự bịa thông tin về công ty như giá, chính sách, thời hạn, địa chỉ hay cam kết. Đọc tài liệu của công ty trong thư mục làm việc. Nếu không có, hỏi người dùng và ghi rõ là chưa có thông tin.`;

export const SKILL_TEMPLATES: readonly SkillTemplate[] = [
  {
    id: 'bao-gia',
    slug: 'bao-gia',
    name: 'Soạn báo giá',
    description:
      'Dùng khi khách hàng hỏi giá hoặc cần một bản báo giá. Soạn bản nháp báo giá từ yêu cầu của khách và bảng giá của công ty.',
    content: `# Soạn báo giá

## Khi nào dùng
- Khách hỏi giá sản phẩm hoặc dịch vụ và cần một bản báo giá chính thức.
- Người dùng nhờ soạn báo giá cho một yêu cầu cụ thể.

## Quy trình
1. Đọc yêu cầu của khách: sản phẩm, số lượng, thời gian giao, địa điểm, yêu cầu đặc biệt.
2. Tìm bảng giá và điều khoản thanh toán trong tài liệu của công ty. ${KHONG_BIA_SU_THAT}
3. Nếu thiếu thông tin quan trọng (số lượng, quy cách, thời hạn), hỏi người dùng trước khi tính.
4. Tính từng dòng: đơn giá x số lượng. Cộng tổng trước thuế, thuế (nếu có), tổng sau thuế.
5. Ghi rõ hiệu lực của báo giá (số ngày), điều kiện thanh toán và điều kiện giao hàng.
6. Kiểm tra lại phép tính. Mỗi số phải khớp với bảng giá.

## Định dạng kết quả
- Tiêu đề: "Báo giá" kèm số báo giá và ngày.
- Thông tin khách hàng và người liên hệ.
- Bảng: STT, mô tả, đơn vị, số lượng, đơn giá, thành tiền.
- Dòng tổng cộng, thuế, tổng thanh toán.
- Điều khoản: hiệu lực, thanh toán, giao nhận, bảo hành (nếu có trong tài liệu công ty).
- Lời chào ngắn ở cuối.

## Khi thiếu thông tin
- Chưa có giá của sản phẩm trong tài liệu: ghi "chưa có giá" và hỏi người phụ trách, không tự ước tính.
- Khách cần số lượng lớn hơn các mức trong bảng giá: ghi rõ mức giá áp dụng và điều kiện, để người dùng xác nhận.
- Chưa rõ giá đã gồm thuế hay chưa: hỏi lại trước khi ghi tổng tiền.

## Không được làm
- ${CHUNG_KHONG_GUI}
- Không giảm giá hoặc tặng thêm khi không có quy định trong tài liệu. Nếu khách xin giảm giá, ghi đề xuất và để người dùng quyết định.
- Không cam kết ngày giao hàng khi chưa hỏi kho hoặc người phụ trách.
- Không dùng giá của đợt trước nếu bảng giá đã thay đổi.
`,
  },
  {
    id: 'theo-doi-khach-hang',
    slug: 'theo-doi-khach-hang',
    name: 'Theo dõi khách hàng',
    description:
      'Dùng khi cần xem lại lịch sử, tình trạng và bước tiếp theo của một khách hàng hoặc một cơ hội bán hàng. Tóm tắt trạng thái và đề xuất việc cần làm.',
    content: `# Theo dõi khách hàng

## Khi nào dùng
- Người dùng hỏi về tình trạng của một khách hàng hoặc một thương vụ.
- Cần nhắc việc đến hạn: gọi lại, gửi báo giá, chờ phản hồi.
- Trước một cuộc gặp hoặc cuộc gọi với khách.

## Quy trình
1. Xác định khách hàng hoặc thương vụ cần xem. Nếu có nhiều người trùng tên, hỏi lại.
2. Đọc lịch sử trao đổi, báo giá đã gửi và ghi chú trong tài liệu hoặc hệ thống của công ty.
3. Ghi lại các mốc: lần liên hệ gần nhất, nội dung đã thống nhất, việc đang chờ, người chịu trách nhiệm.
4. Đánh giá trạng thái: mới, đang tìm hiểu, đã báo giá, đang đàm phán, đã chốt, đã mất.
5. Đề xuất bước tiếp theo, kèm ngày nên làm. Chỉ đề xuất, không tự gửi gì cho khách.
6. Nếu thiếu dữ liệu (không có lịch sử, không rõ người phụ trách), ghi rõ là thiếu.

## Định dạng kết quả
- Tên khách hàng, công ty, người liên hệ.
- Trạng thái hiện tại và từ khi nào.
- Dòng thời gian ngắn: 3 đến 5 mốc gần nhất.
- Việc đang chờ (của ai, từ khi nào).
- Bước tiếp theo đề xuất, kèm ngày đề xuất.
- Rủi ro, nếu có: khách im lặng lâu, đối thủ đang báo giá, thay đổi nhân sự.

## Khi thiếu thông tin
- Không tìm thấy lịch sử của khách: nói rõ là chưa có dữ liệu và đề nghị người dùng bổ sung.
- Khách đã lâu không phản hồi: ghi số ngày kể từ lần liên hệ cuối, không suy đoán lý do.
- Hai người cùng phụ trách một khách: ghi cả hai tên và hỏi ai là đầu mối chính.

## Không được làm
- Không đổi trạng thái khách hàng khi người dùng chưa xác nhận.
- Không suy đoán ý định của khách. Nếu chưa rõ, ghi là chưa rõ.
- Không gửi tin nhắn nhắc khách. ${CHUNG_KHONG_GUI}
- Không gộp thông tin của hai khách hàng khác nhau vào một hồ sơ.
- ${KHONG_BIA_SU_THAT}
`,
  },
  {
    id: 'xu-ly-email',
    slug: 'xu-ly-email',
    name: 'Xử lý email',
    description:
      'Dùng khi người dùng đưa một email đến hoặc nhờ soạn thư trả lời. Tóm tắt nội dung, xác định việc cần làm và soạn bản nháp trả lời.',
    content: `# Xử lý email

## Khi nào dùng
- Người dùng dán hoặc chuyển tiếp một email và hỏi nên làm gì.
- Cần soạn bản nháp trả lời một email.
- Cần phân loại một loạt email: cần trả lời ngay, cần theo dõi, không cần làm gì.

## Quy trình
1. Đọc toàn bộ chuỗi thư, không chỉ thư mới nhất. Chú ý người gửi, người nhận, ngày và các file đính kèm.
2. Tóm tắt trong 2 đến 3 câu: người gửi muốn gì, hạn là khi nào.
3. Phân loại: cần trả lời, cần chuyển người khác, cần theo dõi, chỉ để biết.
4. Nếu cần trả lời, soạn bản nháp. Giữ giọng văn phù hợp với người nhận (đối tác, khách, nội bộ).
5. Nếu email hỏi về giá, chính sách hay cam kết, đối chiếu với tài liệu công ty. ${KHONG_BIA_SU_THAT}
6. Liệt kê các việc cần người dùng quyết định, ví dụ: đồng ý hay từ chối, gửi kèm tài liệu nào.

## Định dạng kết quả
- Tóm tắt: 2 đến 3 câu.
- Phân loại và mức độ gấp (có hạn hay không).
- Việc cần làm, dạng danh sách ngắn.
- Bản nháp trả lời: có tiêu đề, lời chào, nội dung, lời kết và chỗ để người dùng ký tên.
- Ghi chú cho người dùng: điểm cần kiểm tra trước khi gửi.

## Khi thiếu thông tin
- Email không rõ người gửi hoặc có dấu hiệu lừa đảo (yêu cầu chuyển tiền, đổi tài khoản): báo người dùng và không trả lời.
- Email bằng ngôn ngữ khác: tóm tắt bằng tiếng Việt và hỏi người dùng muốn trả lời bằng ngôn ngữ nào.
- Thiếu file đính kèm được nhắc đến: ghi tên file và báo người dùng gửi lại.

## Không được làm
- ${CHUNG_KHONG_GUI}
- Không tự đồng ý điều khoản, giá hay thời hạn mà người dùng chưa xác nhận.
- Không đưa thông tin nhạy cảm (mật khẩu, số tài khoản, dữ liệu cá nhân) vào bản nháp nếu không cần thiết.
- Không bỏ sót file đính kèm hoặc câu hỏi nằm ở cuối thư.
- Không trả lời thay người khác khi email được gửi cho họ mà không có chỉ định.
`,
  },
  {
    id: 'tra-loi-khach',
    slug: 'tra-loi-khach',
    name: 'Trả lời khách hàng',
    description:
      'Dùng khi khách nhắn tin qua Zalo hoặc Facebook và cần soạn câu trả lời. Dựa trên thông tin đã có của công ty và chuyển cho người phụ trách khi vượt quyền.',
    content: `# Trả lời khách hàng

## Khi nào dùng
- Khách nhắn hỏi trên Zalo, Facebook hoặc kênh chat của công ty.
- Người dùng nhờ soạn câu trả lời cho một tin nhắn cụ thể.
- Cần trả lời nhanh các câu hỏi lặp lại như giờ làm việc, giao hàng, đổi trả.

## Quy trình
1. Đọc tin nhắn của khách và các tin trước đó để hiểu bối cảnh.
2. Xác định khách hỏi gì. Nếu có nhiều câu hỏi, trả lời theo thứ tự.
3. Tìm câu trả lời trong tài liệu của công ty (câu hỏi thường gặp, chính sách, bảng giá). ${KHONG_BIA_SU_THAT}
4. Nếu câu hỏi vượt quyền (giảm giá, khiếu nại, hoàn tiền, hợp đồng lớn), soạn câu trả lời trung gian và ghi rõ cần chuyển cho người phụ trách.
5. Viết ngắn, lịch sự, xưng hô theo cách công ty quy định. Một tin nhắn nên dưới 5 câu khi có thể.
6. Đọc lại: đúng chính tả, không có thông tin chưa kiểm chứng.

## Định dạng kết quả
- Phân loại: thông tin chung, báo giá, khiếu nại, đặt hàng, khác.
- Bản nháp trả lời, viết sẵn để người dùng dán vào kênh chat.
- Nếu cần chuyển: ghi lý do và tóm tắt cho người phụ trách trong 1 đến 2 câu.
- Nếu thiếu thông tin: danh sách các điều cần hỏi lại khách.

## Khi thiếu thông tin
- Khách hỏi về đơn hàng cụ thể mà không có dữ liệu đơn: hỏi mã đơn hoặc tên khách, không đoán tình trạng.
- Khách hỏi về sản phẩm không có trong tài liệu: trả lời là sẽ kiểm tra và chuyển người phụ trách.
- Khách có dấu hiệu bức xúc: ưu tiên chuyển người phụ trách, bản nháp chỉ xin lỗi và ghi nhận.

## Không được làm
- ${CHUNG_KHONG_GUI}
- Không hứa giảm giá, hoàn tiền, đền bù hoặc thời gian xử lý khi chưa có quy định.
- Không trả lời về nội dung nhạy cảm, tranh cãi hay dữ liệu cá nhân của người khác.
- Không dùng biểu tượng cảm xúc hay ngôn ngữ quảng cáo quá mức trừ khi công ty cho phép.
- Không trả lời bằng tiếng Anh nếu khách viết tiếng Việt, và ngược lại.
`,
  },
  {
    id: 'tom-tat',
    slug: 'tom-tat',
    name: 'Tóm tắt văn bản',
    description:
      'Dùng khi người dùng đưa một văn bản dài, tài liệu, bài báo hoặc chuỗi tin nhắn và muốn nắm nội dung chính nhanh. Tóm tắt có cấu trúc, không thêm ý ngoài văn bản.',
    content: `# Tóm tắt văn bản

## Khi nào dùng
- Người dùng đưa một tài liệu, báo cáo, bài viết hoặc chuỗi tin nhắn dài.
- Cần nắm nhanh nội dung chính trước khi đọc kỹ hoặc trước một cuộc họp.

## Quy trình
1. Đọc hết văn bản. Xác định loại văn bản: báo cáo, hợp đồng, bài viết, tin nhắn, biên bản.
2. Hỏi người dùng mục đích nếu không rõ: cần tóm tắt để làm gì, dài bao nhiêu.
3. Tìm ý chính: mục đích của văn bản, kết luận, số liệu quan trọng, việc cần làm.
4. Gom các ý theo nhóm. Bỏ ví dụ, lời dẫn và phần lặp lại.
5. Giữ nguyên số liệu, tên riêng, ngày tháng. Không làm tròn số.
6. Kiểm tra: mọi ý trong bản tóm tắt phải có trong văn bản gốc.

## Định dạng kết quả
- Một câu nêu nội dung chính.
- Các ý chính, dạng gạch đầu dòng, tối đa 7 ý.
- Số liệu và ngày quan trọng (nếu có).
- Việc cần làm hoặc quyết định cần đưa ra (nếu có).
- Độ dài mặc định khoảng 150 đến 250 chữ, trừ khi người dùng yêu cầu khác.

## Khi thiếu thông tin
- Văn bản quá dài để đọc một lần: tóm tắt từng phần rồi tổng hợp, ghi rõ đã đọc đến đâu.
- Văn bản có bảng hoặc hình không đọc được: ghi chú phần đã bỏ qua trong bản tóm tắt.
- Văn bản có nhiều ý kiến trái nhau: ghi cả hai phía, không chọn một phía.

## Không được làm
- Không thêm nhận định, đánh giá hay thông tin từ bên ngoài văn bản.
- Không sửa số liệu hoặc diễn giải khác với nguyên văn.
- Không bỏ qua phần cảnh báo, điều kiện hay ngoại lệ trong văn bản.
- Không tóm tắt một phần văn bản rồi nói là toàn bộ. Nếu chỉ đọc được một phần, ghi rõ.
- Không dùng giọng quảng cáo hay khen ngợi.
`,
  },
  {
    id: 'dich',
    slug: 'dich',
    name: 'Dịch thuật',
    description:
      'Dùng khi cần dịch một đoạn văn, tài liệu hoặc tin nhắn giữa tiếng Việt và tiếng Anh (hoặc ngôn ngữ khác). Giữ đúng nghĩa, giọng văn và thuật ngữ của công ty.',
    content: `# Dịch thuật

## Khi nào dùng
- Người dùng nhờ dịch một đoạn văn, email, tài liệu hoặc tin nhắn khách.
- Cần dịch nội dung marketing, hợp đồng hoặc hướng dẫn sử dụng.

## Quy trình
1. Xác định ngôn ngữ nguồn và ngôn ngữ đích. Nếu không rõ, hỏi người dùng.
2. Xác định đối tượng đọc và mục đích: nội bộ, khách hàng, pháp lý, quảng cáo.
3. Kiểm tra tài liệu thuật ngữ của công ty (glossary, tên sản phẩm, tên riêng) nếu có. Giữ nguyên thuật ngữ đã thống nhất.
4. Dịch theo nghĩa, không dịch từng chữ. Giữ cấu trúc đoạn và danh sách như bản gốc.
5. Với tên riêng, mã sản phẩm, số liệu, đơn vị: giữ nguyên, trừ khi có quy ước khác.
6. Đọc lại bản dịch, so với bản gốc để chắc không thiếu ý, không thừa ý.

## Định dạng kết quả
- Bản dịch hoàn chỉnh, giữ định dạng của bản gốc.
- Nếu có từ hoặc câu nhiều nghĩa: ghi chú ngắn sau bản dịch, nêu các cách hiểu và lý do chọn.
- Nếu có thuật ngữ mới chưa có trong tài liệu công ty: liệt kê để người dùng xác nhận.

## Khi thiếu thông tin
- Không chắc nghĩa của một thuật ngữ chuyên ngành: giữ tiếng gốc trong ngoặc và hỏi người dùng.
- Văn bản viết tắt nhiều: liệt kê các chữ viết tắt và cách dịch đã dùng.
- Văn bản có lỗi chính tả hay ngữ pháp trong bản gốc: dịch theo ý định của người viết và ghi chú lại.

## Không được làm
- Không dịch văn bản pháp lý hay hợp đồng như bản chính thức. Ghi rõ cần người có chuyên môn kiểm tra.
- Không thêm lời giải thích, lời chào hay ý kiến vào bản dịch.
- Không đổi tên riêng, mã số hay số liệu.
- ${CHUNG_KHONG_GUI}
- Không dùng máy dịch có sẵn làm bản cuối mà không đọc lại.
`,
  },
  {
    id: 'viet-bai',
    slug: 'viet-bai',
    name: 'Viết bài nội dung',
    description:
      'Dùng khi cần viết bài đăng Facebook, bài blog, mô tả sản phẩm hoặc nội dung marketing. Viết theo brief đã có và giọng văn của công ty.',
    content: `# Viết bài nội dung

## Khi nào dùng
- Người dùng nhờ viết bài đăng Facebook, bài blog, bản tin hoặc mô tả sản phẩm.
- Cần viết lại một bài cũ cho kênh hoặc đối tượng khác.

## Quy trình
1. Hỏi hoặc xác định brief: kênh đăng, đối tượng đọc, mục tiêu (nhận biết, tương tác, bán hàng), thông điệp chính, độ dài.
2. Đọc tài liệu về công ty và sản phẩm để lấy đúng thông tin. ${KHONG_BIA_SU_THAT}
3. Chọn cấu trúc phù hợp kênh: bài Facebook ngắn, mở đầu rõ; bài blog có tiêu đề và các mục.
4. Viết bản nháp đầu tiên. Dùng ví dụ cụ thể thay vì tính từ chung chung.
5. Đọc lại theo giọng của công ty. Bỏ những câu sáo rỗng như "chất lượng hàng đầu" nếu không có số liệu chứng minh.
6. Đề xuất 2 đến 3 tiêu đề hoặc câu mở đầu để người dùng chọn.

## Định dạng kết quả
- Tiêu đề hoặc câu mở đầu (2 đến 3 lựa chọn).
- Nội dung bài, đúng độ dài yêu cầu.
- Gợi ý hashtag hoặc lời kêu gọi hành động, nếu phù hợp kênh.
- Gợi ý ảnh minh họa dưới dạng mô tả ngắn. Nếu cần tạo ảnh, dùng skill tạo brief ảnh.
- Ghi chú: thông tin nào cần người dùng kiểm tra lại.

## Khi thiếu thông tin
- Chưa rõ sản phẩm hay chiến dịch: hỏi trước khi viết, không viết chung chung.
- Chưa có thông tin về đối tượng: đề xuất hai nhóm đối tượng và để người dùng chọn.
- Brief mâu thuẫn (vừa ngắn vừa đủ mọi ý): nêu mâu thuẫn và đề xuất cách bỏ bớt ý.

## Không được làm
- ${CHUNG_KHONG_GUI}
- Không đăng hoặc lên lịch bài viết thay người dùng.
- Không nêu giá, khuyến mãi, cam kết hay con số khi chưa có trong tài liệu.
- Không sao chép nguyên văn nội dung của người khác.
- Không dùng ngôn từ so sánh xúc phạm đối thủ.
- Không viết quá dài cho kênh cần ngắn gọn như Facebook.
`,
  },
  {
    id: 'tao-anh',
    slug: 'tao-anh',
    name: 'Viết brief tạo ảnh',
    description:
      'Dùng khi cần một hình ảnh cho bài đăng, banner hoặc sản phẩm. Claude không tự tạo ảnh, nên skill này viết brief và lời nhắc (prompt) để người dùng hoặc công cụ thiết kế tạo ảnh.',
    content: `# Viết brief tạo ảnh

## Khi nào dùng
- Người dùng cần ảnh minh họa cho bài đăng, banner, poster hoặc ảnh sản phẩm.
- Cần chuẩn bị yêu cầu thiết kế để gửi cho người làm thiết kế hoặc công cụ tạo ảnh.

## Lưu ý quan trọng
Claude không tạo được ảnh trong skill này. Việc của skill là viết brief rõ ràng để người dùng tạo ảnh bằng công cụ có sẵn, ví dụ Canva, công cụ tạo ảnh AI mà công ty đang dùng, hoặc đưa cho người thiết kế.

## Quy trình
1. Hỏi mục đích ảnh: dùng ở đâu (Facebook, website, poster), kích thước, tỷ lệ khung hình.
2. Hỏi thông điệp chính và cảm xúc cần gợi lên.
3. Đọc tài liệu về thương hiệu (màu chính, logo, phong cách) nếu có. Nếu không có, hỏi người dùng. Không tự chọn màu thương hiệu.
4. Viết brief gồm: mục đích, nội dung hình, bố cục, màu sắc, chữ trên ảnh, phong cách, những thứ không được có.
5. Viết thêm một lời nhắc ngắn bằng tiếng Anh để dán vào công cụ tạo ảnh AI, nếu người dùng dùng công cụ đó.
6. Gợi ý nơi tạo: công cụ thiết kế có khuôn mẫu, công cụ AI, hoặc thuê thiết kế, kèm lý do ngắn.

## Định dạng kết quả
- Mục đích và kích thước.
- Brief chi tiết theo từng mục (nội dung, bố cục, màu, chữ, phong cách).
- Lời nhắc tiếng Anh (một đoạn, khoảng 2 đến 4 câu).
- Phương án thay thế, nếu có.
- Danh sách điều cần người dùng xác nhận trước khi làm.

## Khi thiếu thông tin
- Chưa có logo hoặc màu thương hiệu: để trống phần đó trong brief và ghi cần bổ sung.
- Chưa rõ kênh đăng: hỏi trước, vì kích thước và tỷ lệ khác nhau giữa các kênh.
- Có chữ phải hiển thị trên ảnh: ghi đúng nội dung chữ, không để công cụ tự viết.

## Không được làm
- Không nói là đã tạo ảnh hay đính kèm ảnh khi không có.
- Không tạo chữ, logo hay số liệu trong ảnh khi chưa có nội dung đã duyệt.
- Không dùng hình người thật, nhãn hiệu hay tác phẩm của người khác nếu chưa được phép.
- Không gợi ý ảnh có nội dung gây hiểu nhầm về sản phẩm hoặc giá.
- ${KHONG_BIA_SU_THAT}
`,
  },
  {
    id: 'nghien-cuu-web',
    slug: 'nghien-cuu-web',
    name: 'Nghiên cứu trên web',
    description:
      'Dùng khi cần tìm thông tin trên internet về thị trường, sản phẩm, giá, quy định hoặc xu hướng, và cần kết quả có nguồn rõ ràng. Tổng hợp và đánh giá độ tin cậy của nguồn.',
    content: `# Nghiên cứu trên web

## Khi nào dùng
- Người dùng cần tìm thông tin mới về thị trường, sản phẩm, giá tham khảo, quy định hoặc xu hướng.
- Cần so sánh nhiều nguồn để trả lời một câu hỏi.

## Quy trình
1. Làm rõ câu hỏi nghiên cứu: cần biết điều gì, phạm vi địa lý, khoảng thời gian, mục đích.
2. Chia câu hỏi thành 3 đến 5 truy vấn tìm kiếm cụ thể. Dùng cả tiếng Việt và tiếng Anh nếu cần.
3. Ưu tiên nguồn chính thức: trang của cơ quan nhà nước, công ty, báo có uy tín, báo cáo ngành.
4. Mở và đọc nguồn, không chỉ đọc tiêu đề hay đoạn trích. Ghi lại ngày đăng.
5. Đối chiếu các thông tin quan trọng qua ít nhất hai nguồn độc lập. Ghi rõ chỗ không thống nhất.
6. Loại bỏ nguồn không rõ tác giả, nguồn tổng hợp lại từ nguồn khác mà không dẫn gốc, hoặc đã quá cũ với thông tin thay đổi nhanh.

## Định dạng kết quả
- Câu trả lời ngắn ở đầu, trong 2 đến 4 câu.
- Các phát hiện chính, mỗi ý kèm nguồn và ngày.
- Danh sách nguồn: tên, đường dẫn, ngày đăng hoặc ngày truy cập.
- Mức độ chắc chắn của từng kết luận: chắc, cần kiểm tra, chưa đủ dữ liệu.
- Những điều chưa tìm được.

## Khi thiếu thông tin
- Nguồn trái ngược nhau và không xác định được nguồn nào đúng: ghi cả hai và nêu lý do chưa kết luận.
- Không tìm được nguồn đáng tin: nói rõ là chưa có bằng chứng, không đưa con số ước lượng như số thật.
- Thông tin có thể đã cũ: ghi ngày và đề nghị người dùng kiểm tra lại trước khi dùng.

## Không được làm
- Không đưa ra số liệu hay trích dẫn mà không có nguồn.
- Không trình bày thông tin suy đoán như sự thật.
- Không sao chép nguyên đoạn dài từ một nguồn. Chỉ tóm tắt và dẫn nguồn.
- Không dùng kết quả tìm kiếm của công cụ như bằng chứng khi chưa mở nguồn.
- Không tự kết luận về pháp lý hay tài chính. Ghi rõ cần chuyên gia kiểm tra.
`,
  },
  {
    id: 'doi-thu',
    slug: 'doi-thu',
    name: 'Phân tích đối thủ',
    description:
      'Dùng khi cần so sánh công ty với đối thủ về sản phẩm, giá công khai, kênh bán và nội dung marketing. Chỉ dùng thông tin công khai và ghi nguồn.',
    content: `# Phân tích đối thủ

## Khi nào dùng
- Người dùng muốn biết đối thủ đang bán gì, giá bao nhiêu, quảng cáo thế nào.
- Cần chuẩn bị cho một kế hoạch giá, chiến dịch marketing hoặc đàm phán.

## Quy trình
1. Xác định danh sách đối thủ cần xem (tối đa 5 đến 7 đơn vị). Hỏi người dùng nếu chưa có danh sách.
2. Đọc tài liệu của công ty để biết sản phẩm và giá của mình. ${KHONG_BIA_SU_THAT}
3. Với mỗi đối thủ, thu thập thông tin công khai: trang sản phẩm, bảng giá niêm yết, khuyến mãi đang chạy, kênh bán, nội dung trên Facebook hoặc website.
4. Ghi ngày xem và đường dẫn nguồn cho từng thông tin. Giá trên trang web có thể đã cũ, ghi chú điều này.
5. Lập bảng so sánh: sản phẩm, giá, điểm mạnh, điểm yếu, kênh, thông điệp chính.
6. Rút ra 3 đến 5 nhận định, mỗi nhận định ghi rõ dựa trên dữ liệu nào.

## Định dạng kết quả
- Tóm tắt 3 đến 5 câu.
- Bảng so sánh có cột: đối thủ, sản phẩm, giá (kèm ngày xem), điểm khác biệt.
- Nhận định và đề xuất, mỗi mục kèm căn cứ.
- Nguồn và ngày xem.
- Những thông tin không tìm được công khai.

## Khi thiếu thông tin
- Đối thủ không có trang công khai: ghi là không tìm thấy thông tin công khai, không suy đoán.
- Giá đối thủ không rõ hoặc chỉ có khi đặt hàng: ghi "liên hệ để biết giá".
- Đối thủ thay đổi tên hoặc sáp nhập: ghi lại cả tên cũ và tên mới kèm nguồn.

## Không được làm
- Không lấy thông tin nội bộ, tài liệu mật hoặc dữ liệu của đối thủ bằng cách không hợp pháp.
- Không đăng nhập vào tài khoản của đối thủ hay thu thập dữ liệu cá nhân của họ.
- Không đưa giá đối thủ vào báo giá cho khách như thể đó là giá của công ty.
- Không nói xấu đối thủ trong nội dung đề xuất cho khách hàng.
- Không đoán chiến lược của đối thủ khi chưa có bằng chứng.
`,
  },
  {
    id: 'doc-hoa-don-pdf',
    slug: 'doc-hoa-don-pdf',
    name: 'Đọc hóa đơn PDF',
    description:
      'Dùng khi có file hóa đơn, phiếu thu hoặc chứng từ dạng PDF cần lấy thông tin: số hóa đơn, ngày, bên bán, bên mua, các dòng hàng và tổng tiền. Trả về bảng dữ liệu để kế toán kiểm tra.',
    content: `# Đọc hóa đơn PDF

## Khi nào dùng
- Người dùng gửi một hoặc nhiều file hóa đơn, phiếu thu, phiếu chi ở dạng PDF.
- Cần nhập thông tin hóa đơn vào sổ sách hoặc bảng tính.

## Quy trình
1. Mở file PDF và xác định đây là hóa đơn, phiếu hay chứng từ khác. Nếu không đọc được (ảnh quét mờ), báo ngay.
2. Lấy các trường cơ bản: số hóa đơn, ký hiệu, ngày lập, mã số thuế và tên bên bán, mã số thuế và tên bên mua.
3. Lấy từng dòng hàng hóa hoặc dịch vụ: tên, đơn vị tính, số lượng, đơn giá, thành tiền, thuế suất.
4. Lấy tổng cộng: tiền trước thuế, tiền thuế, tổng thanh toán. Ghi cả dạng chữ nếu có.
5. Kiểm tra số học: tổng các dòng có khớp với tổng trước thuế không; thuế có đúng thuế suất không.
6. Ghi chú mọi chỗ không rõ hoặc không khớp. Không tự sửa số.

## Định dạng kết quả
- Bảng thông tin chung, mỗi file một dòng: tên file, số hóa đơn, ngày, bên bán, tổng tiền.
- Bảng chi tiết các dòng hàng (nếu cần), mỗi dòng ghi rõ file nguồn.
- Trạng thái kiểm tra: khớp, lệch (ghi số lệch), không đọc được.
- Danh sách việc cần người kiểm tra lại.
- Dữ liệu xuất dạng bảng để dán vào Excel khi người dùng yêu cầu.

## Khi thiếu thông tin
- File là ảnh chụp, không có chữ đọc được: báo người dùng và đề nghị gửi bản PDF gốc hoặc ảnh rõ hơn.
- Hóa đơn có nhiều trang: đọc đủ tất cả trang trước khi tổng hợp.
- Hóa đơn bị hủy hoặc thay thế: ghi trạng thái nếu có trong file, không tự loại khỏi danh sách.

## Không được làm
- Không đoán số nếu chữ mờ hoặc bị che. Ghi "không rõ" và nêu vị trí.
- Không tự điều chỉnh số liệu để cho khớp tổng.
- Không xác nhận hóa đơn hợp lệ về mặt pháp lý. Chỉ kiểm tra dữ liệu có trong file.
- Không lưu hay gửi dữ liệu mã số thuế, tài khoản ngân hàng ra ngoài cuộc trò chuyện.
- Không ghi sổ hay nộp thuế thay người dùng.
`,
  },
  {
    id: 'phan-tich-excel',
    slug: 'phan-tich-excel',
    name: 'Phân tích bảng tính Excel',
    description:
      'Dùng khi có file Excel hoặc CSV cần làm sạch, tổng hợp, đối chiếu hoặc tìm xu hướng. Trả về kết quả kèm công thức hoặc cách làm để người dùng kiểm tra lại.',
    content: `# Phân tích bảng tính Excel

## Khi nào dùng
- Người dùng gửi file Excel hoặc CSV và hỏi về số liệu.
- Cần tổng hợp theo nhóm, đối chiếu hai bảng, tìm dòng bất thường hoặc tính tỷ lệ.

## Quy trình
1. Mở file và xem từng sheet: tên cột, số dòng, dòng tiêu đề, ô trống, ô gộp.
2. Mô tả ngắn cấu trúc dữ liệu cho người dùng xác nhận. Hỏi lại nếu câu hỏi chưa rõ.
3. Làm sạch có ghi chú: bỏ dòng trống, chuẩn hóa định dạng ngày và số, sửa khoảng trắng thừa. Không xóa dữ liệu gốc.
4. Thực hiện phép tính. Với công thức, viết lại dưới dạng công thức Excel để người dùng tự kiểm tra.
5. Kiểm tra kết quả: tổng có khớp với nguồn không, có số âm hay ngày sai bất thường không.
6. Tóm tắt phát hiện bằng lời, kèm bảng số liệu chính.

## Định dạng kết quả
- Tóm tắt 2 đến 4 câu về kết quả.
- Bảng số liệu chính, có tiêu đề cột và đơn vị.
- Công thức hoặc các bước đã dùng.
- Danh sách dòng bất thường, kèm số dòng trong file gốc.
- Ghi chú về dữ liệu thiếu hoặc không nhất quán.

## Khi thiếu thông tin
- Cột có kiểu dữ liệu lẫn lộn (chữ và số trong cùng cột): ghi số dòng bị ảnh hưởng và hỏi cách xử lý.
- Sheet quá lớn để xem hết: xem mẫu đầu, cuối và các dòng bất thường, ghi rõ phạm vi đã phân tích.
- Công thức trong file có lỗi (#REF, #DIV/0): liệt kê ô bị lỗi, không tự sửa công thức gốc.

## Không được làm
- Không ghi đè file gốc. Nếu cần file mới, tạo bản sao.
- Không xóa dòng dữ liệu chỉ vì có vẻ sai. Đánh dấu và hỏi người dùng.
- Không làm tròn số khi chưa được yêu cầu.
- Không suy diễn nguyên nhân khi dữ liệu chỉ cho thấy hiện tượng.
- Không dùng số liệu từ file khác nếu người dùng không yêu cầu đối chiếu.
`,
  },
  {
    id: 'bao-cao-thang',
    slug: 'bao-cao-thang',
    name: 'Báo cáo tháng',
    description:
      'Dùng khi cần lập báo cáo tháng cho quản lý hoặc kế toán từ số liệu có sẵn: doanh thu, chi phí, công việc đã làm và kế hoạch tháng sau. Chỉ dùng số liệu đã có.',
    content: `# Báo cáo tháng

## Khi nào dùng
- Cuối tháng, người dùng cần báo cáo kết quả hoạt động cho quản lý.
- Cần tổng hợp số liệu từ nhiều nguồn thành một báo cáo ngắn gọn.

## Quy trình
1. Xác định phạm vi báo cáo: phòng ban, tháng, đối tượng nhận (ban lãnh đạo, kế toán, khách).
2. Thu thập số liệu từ file, bảng tính, hệ thống hoặc ghi chú mà người dùng cung cấp. Không tự tìm số liệu không có trong nguồn.
3. So sánh với tháng trước và với kế hoạch nếu có dữ liệu. Ghi rõ nếu không có số để so sánh.
4. Viết phần kết quả: những gì đạt, những gì chưa đạt, và lý do đã được ghi nhận.
5. Viết phần việc đã làm, việc đang dở, việc tháng sau.
6. Liệt kê rủi ro hoặc đề nghị cần quyết định, kèm người chịu trách nhiệm nếu có.

## Định dạng kết quả
- Tiêu đề: báo cáo tháng, phòng ban, thời gian.
- Tóm tắt điều hành: 3 đến 5 gạch đầu dòng.
- Bảng số liệu: chỉ tiêu, thực hiện, kế hoạch, chênh lệch, tháng trước.
- Công việc đã làm, đang làm, kế hoạch tháng sau.
- Rủi ro và đề nghị.
- Nguồn số liệu ở cuối báo cáo.

## Khi thiếu thông tin
- Thiếu số liệu của một chỉ tiêu: ghi "chưa có số liệu" trong bảng, không điền số ước lượng.
- Số liệu từ hai nguồn không khớp: ghi cả hai con số và nguồn của từng số.
- Chưa có kế hoạch để so sánh: bỏ cột chênh lệch và ghi rõ lý do.

## Không được làm
- Không bịa số liệu hoặc làm tròn để báo cáo đẹp hơn.
- Không che giấu số âm hoặc việc chậm tiến độ.
- Không đưa nhận xét về cá nhân trong báo cáo chung.
- Không gửi báo cáo cho bên ngoài công ty. Chỉ soạn để người dùng xem và gửi.
- Không đưa thông tin lương, dữ liệu nhân sự nhạy cảm vào báo cáo chung.
`,
  },
  {
    id: 'loc-cv',
    slug: 'loc-cv',
    name: 'Lọc CV ứng viên',
    description:
      'Dùng khi cần xem nhiều hồ sơ ứng tuyển và so với yêu cầu của vị trí. Tóm tắt từng hồ sơ và xếp nhóm để người tuyển dụng quyết định. Không đưa quyết định tuyển cuối cùng.',
    content: `# Lọc CV ứng viên

## Khi nào dùng
- Người tuyển dụng gửi nhiều CV cho một vị trí và cần sàng lọc ban đầu.
- Cần tóm tắt điểm mạnh, điểm còn thiếu của từng ứng viên theo mô tả công việc.

## Quy trình
1. Đọc mô tả công việc và yêu cầu bắt buộc. Nếu chưa có, hỏi người tuyển dụng.
2. Chuyển các yêu cầu thành tiêu chí cụ thể: kinh nghiệm, kỹ năng, bằng cấp, địa điểm, mức lương (nếu có trong yêu cầu).
3. Đọc từng CV. Ghi lại thông tin có trong CV: kinh nghiệm, kỹ năng, dự án, thời gian làm việc.
4. Đối chiếu với tiêu chí. Ghi rõ tiêu chí nào có bằng chứng, tiêu chí nào không có trong CV.
5. Xếp nhóm: phù hợp cao, cần xem thêm, chưa phù hợp. Ghi lý do ngắn cho mỗi nhóm.
6. Liệt kê câu hỏi nên hỏi trong buổi phỏng vấn để làm rõ những điểm chưa rõ.

## Định dạng kết quả
- Tiêu chí đã dùng để sàng lọc.
- Bảng tóm tắt: tên ứng viên, kinh nghiệm chính, điểm khớp, điểm thiếu, nhóm.
- Lý do xếp nhóm, dựa trên nội dung CV.
- Câu hỏi gợi ý cho phỏng vấn.
- Ghi chú: CV nào không đọc được hoặc thiếu thông tin.

## Khi thiếu thông tin
- CV bằng ảnh hoặc bị hỏng: ghi là không đọc được và đề nghị người tuyển dụng gửi lại.
- Ứng viên có khoảng trống thời gian hoặc đổi nghề: ghi lại sự thật trong CV, không suy diễn.
- Yêu cầu tuyển dụng quá chung chung: hỏi người tuyển dụng các tiêu chí cụ thể trước khi chấm.

## Không được làm
- Không từ chối hay loại ứng viên là quyết định cuối. Chỉ đề xuất nhóm.
- Không đánh giá dựa trên giới tính, tuổi, tôn giáo, dân tộc, hình ảnh, tình trạng hôn nhân hay thông tin không liên quan đến công việc.
- Không suy đoán tính cách hay sức khỏe từ CV.
- Không gửi thông tin ứng viên cho người ngoài công ty.
- Không liên hệ ứng viên khi người tuyển dụng chưa yêu cầu.
`,
  },
  {
    id: 'hen-lich',
    slug: 'hen-lich',
    name: 'Hẹn lịch',
    description:
      'Dùng khi cần đề xuất thời gian họp, hẹn khách hoặc đối tác, hoặc soạn tin nhắn xác nhận lịch. Kiểm tra trùng lịch trước khi đề xuất.',
    content: `# Hẹn lịch

## Khi nào dùng
- Người dùng muốn hẹn một cuộc họp, cuộc gọi hoặc buổi gặp khách.
- Cần đề xuất vài khung giờ phù hợp và soạn tin nhắn hẹn hoặc xác nhận.

## Quy trình
1. Xác định: ai tham gia, mục đích, thời lượng, hình thức (trực tiếp, gọi video, điện thoại), địa điểm.
2. Xác định múi giờ và ngày làm việc. Hỏi nếu người tham gia ở nơi khác.
3. Kiểm tra lịch của người dùng và người tham gia nếu có quyền truy cập. Nếu không, hỏi người dùng khung giờ bận.
4. Đề xuất 2 đến 3 khung giờ, tránh giờ nghỉ trưa và đầu giờ sáng sớm trừ khi người dùng đồng ý.
5. Soạn tin nhắn hẹn: thời gian rõ ràng kèm múi giờ, mục đích, cách tham gia, số người liên hệ.
6. Khi có xác nhận, tóm tắt lịch cuối cùng để người dùng kiểm tra trước khi tạo sự kiện.

## Định dạng kết quả
- Danh sách khung giờ đề xuất, ghi rõ ngày, giờ, múi giờ.
- Tin nhắn hẹn, viết sẵn để người dùng gửi.
- Thông tin lịch cuối cùng sau khi được xác nhận: tiêu đề, thời gian, địa điểm hoặc link, người tham gia.
- Ghi chú về xung đột lịch nếu có.

## Khi thiếu thông tin
- Không biết múi giờ của người được hẹn: hỏi trước khi đề xuất giờ.
- Không có quyền xem lịch: hỏi người dùng khung giờ bận và không đoán.
- Cuộc hẹn cần nhiều người và không ai rảnh cùng lúc: đề xuất cách họp ngắn hơn hoặc nhiều lần.

## Không được làm
- ${CHUNG_KHONG_GUI}
- Không tạo sự kiện trong lịch của người khác khi chưa được phép.
- Không hứa một khung giờ khi chưa kiểm tra lịch hoặc chưa có xác nhận.
- Không đặt lịch trùng với khung giờ đã có, nếu không được người dùng yêu cầu.
- Không chia sẻ chi tiết lịch bận của người dùng với bên ngoài.
`,
  },
  {
    id: 'tom-tat-hop',
    slug: 'tom-tat-hop',
    name: 'Tóm tắt cuộc họp',
    description:
      'Dùng khi có ghi chú, bản ghi âm đã chuyển thành chữ hoặc biên bản của một cuộc họp và cần tóm tắt kết luận, việc cần làm và người phụ trách.',
    content: `# Tóm tắt cuộc họp

## Khi nào dùng
- Người dùng đưa ghi chú hoặc bản chép lời của một cuộc họp.
- Cần gửi tóm tắt cho người tham gia hoặc người vắng mặt.

## Quy trình
1. Đọc toàn bộ ghi chú. Xác định mục đích cuộc họp, người tham gia và thời gian.
2. Tìm các kết luận đã thống nhất. Phân biệt với ý kiến đề xuất chưa được chốt.
3. Tìm việc cần làm: nội dung, người phụ trách, hạn hoàn thành. Nếu thiếu người hoặc hạn, ghi là chưa rõ.
4. Tìm các vấn đề còn mở, cần quyết định ở cuộc họp sau.
5. Viết tóm tắt theo thứ tự: mục đích, kết luận, việc cần làm, vấn đề mở.
6. Đối chiếu lại với ghi chú gốc để chắc không đổi nghĩa.

## Định dạng kết quả
- Tiêu đề: tên cuộc họp, ngày, người tham gia.
- Mục đích: 1 câu.
- Kết luận đã thống nhất: danh sách ngắn.
- Việc cần làm: bảng gồm việc, người phụ trách, hạn.
- Vấn đề còn mở.
- Ghi chú: phần nào ghi chú không rõ hoặc có thể sai (ví dụ tên người, số liệu).

## Khi thiếu thông tin
- Ghi chú thiếu tên người phụ trách: ghi "chưa rõ người phụ trách" và đưa vào phần vấn đề mở.
- Hạn hoàn thành chỉ nói chung chung (sớm, tuần sau): ghi nguyên văn và hỏi người dùng ngày cụ thể.
- Bản chép lời có nhiều lỗi nhận dạng giọng nói: đối chiếu ngữ cảnh, ghi chú các chỗ không chắc.

## Không được làm
- Không gán việc cho người không được nhắc đến trong cuộc họp.
- Không thêm kết luận mà ghi chú không có.
- Không gửi biên bản cho người ngoài công ty khi chưa có duyệt.
- Không ghi lại lời nói riêng tư hoặc nhận xét cá nhân không liên quan đến công việc.
- Không coi ý kiến của một người là quyết định của cả nhóm.
`,
  },
  {
    id: 'review-code',
    slug: 'review-code',
    name: 'Review code',
    description:
      'Dùng khi cần xem lại một thay đổi code (diff, pull request, đoạn code) để tìm lỗi, rủi ro bảo mật và vấn đề hiệu năng. Chỉ nhận xét, không tự sửa code khi chưa được yêu cầu.',
    content: `# Review code

## Khi nào dùng
- Người dùng gửi một diff, pull request hoặc đoạn code và nhờ xem lại.
- Cần kiểm tra trước khi merge một thay đổi.

## Quy trình
1. Đọc mô tả thay đổi và mục đích. Nếu không có, hỏi người dùng.
2. Đọc toàn bộ diff, sau đó đọc các file liên quan để hiểu ngữ cảnh.
3. Kiểm tra theo thứ tự: đúng logic, xử lý lỗi và trường hợp biên, bảo mật (đầu vào không tin cậy, quyền truy cập, lộ dữ liệu), hiệu năng (vòng lặp lồng, truy vấn trong vòng lặp), khả năng đọc và đặt tên.
4. Kiểm tra test: thay đổi có test không, test có kiểm tra đúng việc không.
5. Phân loại nhận xét: lỗi cần sửa trước khi merge, gợi ý, ghi chú nhỏ.
6. Với mỗi lỗi, ghi dòng hoặc file và cách tái hiện nếu có thể.

## Định dạng kết quả
- Tóm tắt: thay đổi làm gì, đánh giá chung (sẵn sàng merge, cần sửa, cần thảo luận).
- Danh sách lỗi cần sửa, mỗi mục gồm file, dòng, mô tả, lý do.
- Danh sách gợi ý và ghi chú nhỏ.
- Các câu hỏi cho tác giả.
- Những phần chưa xem kỹ, nếu có.

## Khi thiếu thông tin
- Không có đủ ngữ cảnh để đánh giá (thiếu file liên quan): liệt kê các file cần xem thêm.
- Thay đổi quá lớn để review trong một lần: chia theo chủ đề và review từng phần.
- Không chắc một đoạn có lỗi hay không: đặt câu hỏi cho tác giả thay vì khẳng định.

## Không được làm
- Không tự sửa code hay commit khi người dùng chỉ yêu cầu review.
- Không nhận xét về phong cách khi đã có công cụ lint của dự án xử lý.
- Không báo lỗi khi chưa đọc đoạn code liên quan.
- Không khẳng định một lỗi chắc chắn khi chưa chạy hoặc chưa kiểm tra. Ghi rõ mức độ chắc chắn.
- Không đưa thông tin bí mật (token, mật khẩu, khóa API) vào nhận xét. Nếu thấy, báo ngay và đề nghị thu hồi.
`,
  },
  {
    id: 'viet-test',
    slug: 'viet-test',
    name: 'Viết test',
    description:
      'Dùng khi cần viết hoặc bổ sung test tự động cho một hàm, module hoặc lỗi đã biết. Theo cách test và thư viện đã có trong dự án.',
    content: `# Viết test

## Khi nào dùng
- Người dùng nhờ viết test cho một hàm, module hoặc API.
- Cần tái hiện một lỗi bằng test trước khi sửa.
- Cần bổ sung test cho một nhánh chưa được kiểm tra.

## Quy trình
1. Đọc code cần test và các test có sẵn trong dự án. Học cách đặt tên, cấu trúc và công cụ mock đang dùng.
2. Liệt kê các trường hợp: đường đi chính, đầu vào hợp lệ, đầu vào sai, giá trị biên, lỗi cần xử lý.
3. Viết từng test có tên mô tả hành vi, ví dụ "trả về lỗi khi số lượng âm". Mỗi test kiểm tra một ý chính.
4. Hạn chế mock. Chỉ mock những gì nằm ngoài hệ thống (mạng, thời gian, cơ sở dữ liệu thật khi không cần).
5. Chạy test. Nếu test không chạy được, báo lý do thay vì sửa test cho qua.
6. Với lỗi đã biết, kiểm tra test thất bại trước khi sửa code, sau đó thành công sau khi sửa.

## Định dạng kết quả
- Danh sách file test đã thêm hoặc sửa.
- Danh sách trường hợp đã phủ, dạng gạch đầu dòng.
- Kết quả chạy test: số test đạt và không đạt.
- Các trường hợp chưa phủ và lý do.

## Khi thiếu thông tin
- Hàm phụ thuộc vào dịch vụ bên ngoài: mock đúng chỗ giao tiếp và ghi rõ trong test.
- Không rõ hành vi đúng của code: hỏi người dùng hoặc đọc tài liệu, không tự đặt kết quả mong đợi theo code hiện tại.
- Dự án chưa có công cụ test: báo người dùng và hỏi trước khi cài thêm thư viện.

## Không được làm
- Không sửa test để test đi qua khi code đang sai. Báo lại cho người dùng.
- Không xóa hay bỏ qua test đang thất bại mà không được phép.
- Không viết test phụ thuộc thứ tự chạy hoặc trạng thái chung giữa các test.
- Không gọi dịch vụ bên ngoài thật (API trả tiền, email thật) trong test.
- Không đưa dữ liệu thật của khách hàng vào fixture.
`,
  },
  {
    id: 'git',
    slug: 'git',
    name: 'Làm việc với Git',
    description:
      'Dùng khi cần xem trạng thái repository, tạo nhánh, commit, đồng bộ với nhánh chính hoặc giải quyết xung đột. Thao tác an toàn, không ghi đè lịch sử đã chia sẻ.',
    content: `# Làm việc với Git

## Khi nào dùng
- Người dùng nhờ kiểm tra thay đổi, tạo nhánh, viết commit message hoặc chuẩn bị commit.
- Cần đồng bộ nhánh với nhánh chính hoặc xử lý xung đột.
- Cần tìm lại lịch sử thay đổi của một file hoặc một lỗi.

## Quy trình
1. Chạy git status và git branch để biết trạng thái và nhánh hiện tại.
2. Xem thay đổi bằng git diff trước khi commit. Kiểm tra không có file bí mật (.env, khóa, token).
3. Commit theo nhóm thay đổi có nghĩa. Message ngắn ở dòng đầu, mô tả lý do ở các dòng sau.
4. Trước khi đồng bộ, cập nhật nhánh chính và xem nhánh hiện tại có đang chạy trước hay không.
5. Khi có xung đột, đọc từng vùng xung đột, giữ đúng phần cần giữ, rồi chạy lại test.
6. Tìm lịch sử bằng git log, git blame hoặc git log -S khi cần tìm nơi thay đổi một đoạn code.

## Định dạng kết quả
- Trạng thái: nhánh, số file thay đổi, file chưa theo dõi.
- Danh sách commit đề xuất, mỗi commit kèm message và file liên quan.
- Lệnh đã chạy và kết quả chính.
- Việc người dùng cần làm: push, tạo pull request, xử lý xung đột còn lại.

## Khi thiếu thông tin
- Có thay đổi chưa commit và người dùng muốn đổi nhánh: đề xuất stash hoặc commit tạm, không bỏ thay đổi.
- Không rõ nhánh nào là nhánh chính: kiểm tra cấu hình remote và hỏi người dùng.
- Commit đã được đẩy lên remote: dùng commit mới để sửa, không viết lại lịch sử.

## Không được làm
- Không chạy git push --force lên nhánh chung hoặc nhánh chính.
- Không chạy git reset --hard, git checkout -- hoặc git clean khi chưa được xác nhận, vì có thể mất thay đổi chưa lưu.
- Không bỏ qua hook của commit (--no-verify) trừ khi người dùng yêu cầu.
- Không commit file chứa thông tin đăng nhập hoặc dữ liệu cá nhân.
- Không tự push hay mở pull request khi người dùng chưa yêu cầu.
- Không sửa lịch sử đã được đẩy lên remote mà không báo người dùng trước.
`,
  },
];

export const skillTemplateById = (id: string): SkillTemplate | undefined =>
  SKILL_TEMPLATES.find((template) => template.id === id);

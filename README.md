# Affiliate Content Engine

Nền tảng tự động hóa nội dung affiliate (Threads + Shopee Affiliate), có lớp "văn phòng AI" gồm các agent theo phòng ban.
Xem thiết kế ở [`docs/PHASE0.md`](docs/PHASE0.md).

## Trạng thái

- **Phase 0**: tài liệu thiết kế (kiến trúc, ERD, quyền API, checklist). Xong.
- **Phase 1**: khung dự án và khung văn phòng AI. Đã chạy được trên máy bạn.
- **Phase 2**: đăng ký/đăng nhập (JWT + refresh token xoay vòng), tổ chức, thành viên, phân quyền theo vai trò, cô lập tenant. **Mới chạy kiểm tra thật cho phần logic thuần; lớp NestJS/DB chưa được biên dịch hay chạy** (xem "Chưa xác minh").

- **Phase 3a**: sản phẩm, nhập CSV, link affiliate, Shopee giả lập (xem bên dưới).
- **Phase 3b**: hồ sơ media và giấy phép (xem bên dưới). Giao diện web: đăng nhập, Văn phòng AI 3D.
- **Phase 4a** (backend): soạn bài, AI đề xuất bản nháp, QA tự động, gửi duyệt và duyệt bởi người (xem bên dưới).
- **Phase 4b** (web): màn hình **Bài viết**: danh sách, tạo bài (AI đề xuất / tự soạn), báo cáo QA, sửa, gửi duyệt, duyệt, lịch sử.
- **Phase 4c** (web): màn hình **Sản phẩm** (thêm tay, nhập CSV có chạy thử, đồng bộ giả lập, link: thêm/xác minh/thu hồi) và **Media** (thêm, khai báo và duyệt giấy phép, lưu trữ, kiểm tra lại). Vá QA: media CC BY bắt buộc bài chứa nguyên văn dòng ghi nguồn.

## Cấu hình bắt buộc cho Phase 2

Thêm vào `.env` (xem `.env.example`): `JWT_ACCESS_SECRET` (>= 32 ký tự ngẫu nhiên), `JWT_ACCESS_TTL_SECONDS`,
`REFRESH_TTL_DAYS`, `CORS_ORIGINS`. Tạo khóa ký:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Sau đó `npm install` (có thêm `@nestjs/jwt`, `@nestjs/throttler`, `helmet`) rồi `npm run migration:run` (2 migration mới).

## API xác thực và tổ chức (`/api/v1`)

| Phương thức | Đường dẫn | Ghi chú |
|---|---|---|
| POST | `/auth/register`, `/auth/login` | công khai, giới hạn 10 lượt/phút |
| POST | `/auth/refresh`, `/auth/logout` | gửi `{ "refreshToken": "..." }` |
| GET | `/auth/me` | cần `Authorization: Bearer <accessToken>` |
| POST/GET | `/organizations` | tạo tổ chức (người tạo là OWNER, có sẵn 8 agent) / liệt kê tổ chức của mình |
| GET/POST | `/organizations/:orgId/members` | xem / thêm thành viên (người đã có tài khoản) |
| PATCH/DELETE | `/organizations/:orgId/members/:memberId` | đổi vai trò / gỡ thành viên |
| GET | `/organizations/:orgId/office/agents`, `/office/stream` | văn phòng AI |
| POST | `/organizations/:orgId/office/agents/:key/status` | `IDLE` hoặc `PAUSED` |

Mọi route đều cần đăng nhập trừ route gắn `@Public()`. Người không thuộc tổ chức nhận 404; thuộc tổ chức nhưng thiếu quyền nhận 403.

## Phase 3a: sản phẩm và link affiliate

Thêm migration 004 (`affiliate_connections`, `products`, `affiliate_links`). Chạy `npm run migration:run`.
**Shopee hiện là GIẢ LẬP (mock)**; tích hợp chính thức chưa triển khai. Dữ liệu giả có tiền tố `[MOCK]`, link giả dùng tên miền `.invalid`.

| Phương thức | Đường dẫn (sau `/organizations/:orgId`) | Ghi chú |
|---|---|---|
| POST/GET | `/affiliate-connections` | tạo kết nối GIẢ LẬP / liệt kê |
| GET | `/products?search=&limit=&offset=` | danh sách, kèm điểm giải thích được |
| POST | `/products` | thêm/cập nhật 1 sản phẩm nhập tay |
| POST | `/products/import` | nhập CSV `{ "csv": "...", "dryRun": true }` (tối đa 500 dòng, 50.000 ký tự) |
| POST | `/products/sync` | đồng bộ từ Shopee giả `{ "connectionId": "..." }` |
| GET | `/products/:productId`, `/products/:productId/links` | chi tiết / link của sản phẩm |
| POST | `/products/:productId/links` | đăng ký link bạn tự có (trạng thái UNVERIFIED) |
| POST | `/products/:productId/links/generate` | tạo link qua nhà cung cấp (giả lập, nguồn MOCK) |
| POST | `/affiliate-links/:linkId/verify` | xác minh link tự nhập: UNVERIFIED -> ACTIVE (OWNER/ADMIN/REVIEWER) |
| POST | `/affiliate-links/:linkId/revoke` | thu hồi link |

Cột CSV: bắt buộc `external_product_id,name,product_url`; tùy chọn `description,category,image_url,price,currency,commission_rate`.
Giá dùng dấu chấm thập phân, không dùng dấu phân cách hàng nghìn; có `price` thì phải có `currency`.
Ô trống nghĩa là CHƯA BIẾT (khác 0) và không xóa giá trị đã biết khi nhập lại.

Quyết định thiết kế: `products` có `organization_id` (khác phác thảo đầu) để tổ chức này không ghi đè dữ liệu của tổ chức khác.
Danh sách tên miền link affiliate được phép nằm trong `affiliate-link-url.ts` và là giả định chưa xác minh với tài liệu Shopee.

## Phase 3b: media và giấy phép

Thêm migration 005 (`media_assets`, `media_licenses`). Chạy `npm run migration:run`.
**Giai đoạn này chỉ lưu hồ sơ và URL nguồn (https công khai) của media, chưa lưu file** vì chưa chọn nơi lưu trữ.

Luồng: thêm media -> khai báo giấy phép (chờ duyệt) -> người có quyền `media.review` xác nhận -> media dùng được.
AI/agent không có đường nào để xác nhận giấy phép.

| Phương thức | Đường dẫn (sau `/organizations/:orgId/media`) | Quyền |
|---|---|---|
| POST | `/assets` thêm media `{ mediaType, title, sourceUrl, mimeType? }` | media.write |
| GET | `/assets?licenseStatus=&mediaType=&search=&includeArchived=&limit=&offset=` | media.read |
| GET | `/assets/:assetId` chi tiết + giấy phép + đánh giá trực tiếp | media.read |
| GET | `/assets/:assetId/usability` dùng được ngay lúc này không, kèm dòng ghi nguồn bắt buộc | media.read |
| POST | `/assets/:assetId/licenses` khai báo giấy phép (PENDING) | media.write |
| POST | `/licenses/:licenseId/review` `{ decision: APPROVE\|REJECT, note? }` | media.review |
| POST | `/assets/:assetId/archive` | media.write |
| POST | `/assets/recheck` kiểm tra lại hạn của mọi media đang dùng | media.review |

Loại giấy phép: `OWNED` (cần mô tả cách tạo ra), `CC0` (cần link nguồn), `CC_BY` (cần link, tên tác giả, dòng ghi nguồn),
`COMMERCIAL_PURCHASED` / `PARTNER_GRANTED` (cần bên cấp và link hoặc ghi chú bằng chứng). Bắt buộc khai báo `commercialUseAllowed`;
giấy phép không cho dùng thương mại được ghi nhận nhưng media vẫn không dùng được (nội dung affiliate là thương mại).

Trạng thái media: `UNLICENSED`, `NEEDS_REVIEW`, `VALID`, `EXPIRING_SOON` (còn dưới 14 ngày, vẫn dùng được), `EXPIRED`, `RESTRICTED`, `REJECTED`.
Ngày không kèm giờ hiểu theo giờ Việt Nam (UTC+7); hết hạn tính từ cuối ngày hết hạn.
Trạng thái trong danh sách là bản lưu tạm để lọc; `MediaService.assertUsable()` luôn tính lại tại thời điểm dùng
(Phase 4-5 sẽ gọi nó trước khi gắn media vào bài và ngay trước khi đăng). `recheck` hiện gọi bằng tay, sau này chạy theo lịch.

Quyết định thiết kế (cần bạn xác nhận): tách quyền KHÔNG áp dụng cho duyệt giấy phép, giống xác minh link; người dùng một mình
(OWNER) vẫn duyệt được giấy phép do chính mình khai báo. Nhật ký ghi cả người tạo và người duyệt.

## Phase 4a: nội dung, QA và duyệt bởi người

Migration `1760000500000-ContentPosts` (bảng `content_posts`, `content_post_versions`, `post_approvals`). Đường dẫn: `/api/v1/organizations/:orgId/content/posts`.

| Việc | Endpoint | Quyền |
| --- | --- | --- |
| Danh sách / chi tiết (kèm các phiên bản và lịch sử duyệt) | `GET /`, `GET /:postId` | `content.read` |
| Soạn tay | `POST /` | `content.write` |
| AI đề xuất 1-3 bản nháp | `POST /generate` | `content.write` |
| Sửa (cần `expectedVersion`) | `PATCH /:postId` | `content.write` |
| Chạy lại QA | `POST /:postId/qa` | `content.read` |
| Gửi duyệt / rút lại | `POST /:postId/submit`, `/withdraw` | `content.write` |
| Duyệt / yêu cầu sửa / từ chối | `POST /:postId/review` | `content.review` |
| Xem / đổi cài đặt tổ chức (`separationOfDuties`) | `GET`, `PATCH /organizations/:orgId/settings` | thành viên / `org.manage` |

Nguyên tắc:
- **AI chỉ đề xuất.** Bản nháp luôn ở `DRAFT`, chưa có "người soạn"; không có đường nào để AI duyệt hay đăng. Agent "Viết bài" đang tạm dừng thì `generate` bị từ chối (409) và không gọi LLM.
- **QA tự động** (`content-rules.ts`, logic thuần): độ dài Threads (500 ký tự), có dòng công khai hoa hồng, đúng một link affiliate do hệ thống thêm, câu cam kết/y tế bị cấm, giá nêu trong bài khớp giá đã xác minh (giá không rõ ≠ 0), trùng lặp bài gần đây, nhãn `[MẪU]` còn sót, trạng thái link, giấy phép media (gồm dòng ghi nguồn bắt buộc của giấy phép CC BY: bài phải chứa nguyên văn). Có mục FAIL thì không gửi duyệt được; mục WARN chỉ để người duyệt cân nhắc.
- **Mỗi lần sửa** tăng `content_version`, xóa kết quả QA cũ và đưa bài về `DRAFT` (mất hiệu lực duyệt). Người duyệt phải gửi đúng phiên bản đã xem.
- **Duyệt chạy lại QA ngay lúc duyệt** (link/giấy phép/giá có thể đã đổi từ lúc gửi).
- **Tách quyền** (mặc định bật): người sửa/soạn cuối cùng không tự duyệt bài của mình (403). Bản nháp AI chưa ai sửa thì ai có quyền duyệt cũng duyệt được. Tắt bằng `PATCH .../settings {"separationOfDuties": false}` (ghi nhật ký kiểm toán).
- `LLM_PROVIDER=mock` (mặc định): bản nháp mẫu bắt đầu bằng `[MẪU]`, QA chặn cho tới khi bạn viết lại. `LLM_PROVIDER=claude`: gọi API của Claude (xem mục "Bật AI thật" bên dưới). Bản nháp từ Claude vẫn luôn ở trạng thái DRAFT, qua QA và cần người duyệt.

## Chạy thử (máy của bạn)

Yêu cầu: Node 22, Docker.

```bash
cp .env.example .env            # rồi thay các giá trị CHANGE_ME
docker compose --env-file .env up -d

cd backend
npm install
npm test                        # unit test (không cần DB)
npm run migration:run           # tạo bảng
npm run seed:dev                # tổ chức demo + 8 agent, in ra organizationId
npm run start:dev
```

- Swagger: http://localhost:3000/api/docs
- Liveness: `GET /api/v1/health` · Readiness (DB + Redis): `GET /api/v1/health/ready`
- `npm run seed:dev` không còn cần thiết từ Phase 2: đăng ký tài khoản rồi gọi `POST /organizations`, 8 agent được tạo tự động.

## Giao diện web (`frontend/`)

React 18 + Vite + TypeScript. Hiện có: đăng nhập/đăng ký, chọn hoặc tạo tổ chức, **Văn phòng AI** (bản đồ 3D xoay được bằng CSS 3D, có thể chuyển về 2D;
bong bóng thoại, mũi tên bàn giao, tạm dừng từng bộ phận, chạy mô phỏng) và các trang Sản phẩm, Media, Bài viết (mô tả bên dưới).

**Sản phẩm** (`/products`, `/products/:id`): danh sách có tìm kiếm; thêm tay (giá/hoa hồng để trống = "chưa biết", không bị đổi thành 0; số có dấu phân cách hàng nghìn bị từ chối thay vì hiểu nhầm);
nhập CSV với bước "Kiểm tra trước" không ghi gì rồi mới nhập; đồng bộ Shopee **giả lập**; chi tiết có độ mới của giá, điểm dữ liệu giải thích từng phần, và danh sách link
(thêm link tự có, tạo link giả lập, **xác minh** cần xác nhận hai bước, thu hồi). Link tự nhập luôn ở trạng thái chưa xác minh.

**Media** (`/media`, `/media/:id`): hệ thống chưa lưu file, chỉ lưu địa chỉ https; khai báo giấy phép theo loại (form báo rõ trường nào bắt buộc, khớp quy tắc máy chủ),
người có quyền duyệt xác nhận hoặc từ chối (lý do bắt buộc khi từ chối); trang chi tiết tính lại "có dùng được không" theo thời điểm hiện tại và nêu dòng ghi nguồn bắt buộc.
Ngày hiệu lực hiểu theo giờ Việt Nam. Không hiển thị bản xem trước ảnh từ địa chỉ ngoài (tránh tải nội dung lạ).

**Bài viết** (`/content`, `/content/:postId`): lọc theo trạng thái; tạo bài bằng AI hoặc tự soạn (có đếm ký tự theo giới hạn 500 của Threads);
xem báo cáo QA tách lỗi (chặn gửi duyệt) và cảnh báo (để người duyệt cân nhắc); sửa có kiểm tra xung đột phiên bản (không ghi đè thay đổi của người khác);
gửi duyệt / rút lại; người có quyền duyệt chọn Duyệt / Yêu cầu sửa / Từ chối (lý do bắt buộc khi không duyệt). Khi tách quyền bật, người soạn cuối cùng
không chọn được "Duyệt" (máy chủ cũng chặn). OWNER có công tắc tách quyền ở đầu trang. Nút hiện theo vai trò chỉ là gợi ý; máy chủ kiểm tra lại mọi yêu cầu.

```bash
# terminal 1: backend đang chạy (npm run start:dev trong backend/)
cd frontend
npm install
npm run dev                     # http://localhost:5173
npm test                        # test logic thuần (SSE, reducer văn phòng, bài viết, sản phẩm, media)
npm run typecheck
```

- Vite chuyển tiếp `/api` sang backend `http://localhost:3001` (khớp `PORT=3001` trong `.env` của bạn).
  Backend ở cổng khác thì đặt `VITE_API_TARGET`, ví dụ PowerShell: `$env:VITE_API_TARGET="http://localhost:3000"; npm run dev`.
- Luồng thời gian thực dùng `fetch` (không phải `EventSource`) vì cần gửi header Authorization.
- Refresh token lưu trong `localStorage`, access token chỉ giữ trong bộ nhớ.
- "Chạy mô phỏng" gọi `POST .../office/dev/emit`, chỉ hoạt động khi `NODE_ENV` khác `production`; các tin đều gắn nhãn `[Mô phỏng]`.

## Chưa xác minh

Môi trường dựng mã không cài được package npm (proxy chặn registry). Đã chạy thật: state machine nội dung,
băm mật khẩu, token, vai trò/quyền, slug, chính sách refresh token (qua bộ chạy tối giản, không phải jest).
**Chưa chạy**: `npm run typecheck`/`build`, jest cho phần NestJS (kể cả `content.service.spec.ts`, mới chỉ chạy qua bộ chạy tối giản với kho dữ liệu giả), migration 002-004 trên PostgreSQL (004 = ContentPosts), và toàn bộ luồng
đăng nhập/tổ chức qua HTTP, và `npm install`/`npm run dev`/`npm run typecheck` của `frontend/`
(đã kiểm tra: logic thuần qua bộ chạy tối giản, cú pháp TSX, kết xuất bản đồ và các trang Bài viết/Sản phẩm/Media bằng React + Chromium với dữ liệu giả; chưa thử luồng bấm nút thật với backend). Hãy chạy `npm install && npm run typecheck && npm test` và báo lại lỗi nếu có.

## Chưa làm (Phase sau)

Lưu file media thật (chọn nơi lưu trữ), màn hình giao diện cho sản phẩm/media, tích hợp Shopee chính thức, nhà cung cấp LLM thật (Claude API), xem trước/lưu file media thật, đăng Threads (Phase 5),
analytics + n8n (Phase 6), ESLint, integration test, Dockerfile cho ứng dụng.


## Bật AI thật (Claude)

1. Tạo khóa tại Anthropic Console (Settings → API keys), nạp tín dụng và đặt hạn mức chi tiêu hằng tháng cho workspace riêng.
2. Chuyển repo sang **Private** trước khi đặt khóa thật vào bất cứ đâu gần repo.
3. Trong `backend/`: `npm install @anthropic-ai/sdk` rồi commit `package.json` và `package-lock.json`.
4. Trong `backend/.env` (không commit): `LLM_PROVIDER=claude`, `ANTHROPIC_API_KEY=<khóa>`, tùy chọn `ANTHROPIC_MODEL`.
5. Khởi động lại backend. Thiếu khóa, khóa là giá trị mẫu hoặc thiếu gói SDK thì backend báo lỗi ngay khi khởi động.

AI chỉ nhận tên, danh mục và mô tả sản phẩm (mô tả được coi là dữ liệu không tin cậy). Lỗi từ Claude được chuyển thành 503/502 với thông báo chung, không lộ khóa. **Chưa kiểm chứng:** cuộc gọi thật tới API (sandbox không có mạng và khóa); phần còn lại đã test bằng client giả.

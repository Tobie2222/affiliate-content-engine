# Affiliate Content Engine

Nền tảng tự động hóa nội dung affiliate (Threads + Shopee Affiliate), có lớp "văn phòng AI" gồm các agent theo phòng ban.
Xem thiết kế ở [`docs/PHASE0.md`](docs/PHASE0.md).

## Trạng thái

- **Phase 0**: tài liệu thiết kế (kiến trúc, ERD, quyền API, checklist). Xong.
- **Phase 1**: khung dự án và khung văn phòng AI. Đã chạy được trên máy bạn.
- **Phase 2**: đăng ký/đăng nhập (JWT + refresh token xoay vòng), tổ chức, thành viên, phân quyền theo vai trò, cô lập tenant. **Mới chạy kiểm tra thật cho phần logic thuần; lớp NestJS/DB chưa được biên dịch hay chạy** (xem "Chưa xác minh").

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

## Chưa xác minh

Môi trường dựng mã không cài được package npm (proxy chặn registry). Đã chạy thật: state machine nội dung,
băm mật khẩu, token, vai trò/quyền, slug, chính sách refresh token (qua bộ chạy tối giản, không phải jest).
**Chưa chạy**: `npm run typecheck`/`build`, jest cho phần NestJS, migration 002-003 trên PostgreSQL, và toàn bộ luồng
đăng nhập/tổ chức qua HTTP. Hãy chạy `npm install && npm run typecheck && npm test` và báo lại lỗi nếu có.

## Chưa làm (Phase sau)

Media và giấy phép (Phase 3b), tích hợp Shopee chính thức, AI + duyệt (Phase 4), đăng Threads (Phase 5),
analytics + n8n (Phase 6), ESLint, integration test, Dockerfile cho ứng dụng.

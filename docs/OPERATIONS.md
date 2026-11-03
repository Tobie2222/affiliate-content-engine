# Vận hành Affiliate Content Engine

Tài liệu cho người chạy hệ thống (dev hoặc triển khai thật). Nội dung dựa trên mã hiện có; mục nào chưa kiểm chứng được ghi rõ.

## 1. Biến môi trường

| Biến | Bắt buộc | Ghi chú |
|---|---|---|
| `NODE_ENV` | có | `development`, `test`, `staging`, `production`. Production từ chối giá trị mẫu (`CHANGE_ME`) cho mật khẩu và khóa. |
| `DB_HOST/PORT/USER/PASSWORD/NAME` | có | `DB_PASSWORD` tối thiểu 8 ký tự. |
| `REDIS_HOST/PORT/PASSWORD` | host, port | Redis chỉ làm nhịp cho worker; dữ liệu nghiệp vụ nằm ở PostgreSQL. |
| `JWT_ACCESS_SECRET` | có | Tối thiểu 32 ký tự ngẫu nhiên. Đổi khóa này sẽ đăng xuất mọi phiên. |
| `CORS_ORIGINS` | nên | Danh sách origin của frontend, cách nhau bằng dấu phẩy. Trống = không origin nào được gọi. |
| `LLM_PROVIDER` | không | `mock` (mặc định) hoặc `claude`. |
| `ANTHROPIC_API_KEY` | khi `claude` | Chỉ để ở backend. Thiếu hoặc là `CHANGE_ME` thì backend không khởi động. |
| `ANTHROPIC_MODEL` | không | Trống = `claude-haiku-5-5`. |
| `SHOPEE_PROVIDER` | không | Hiện chỉ `mock` (chưa có tích hợp Shopee thật). |
| `THREADS_PROVIDER` | không | `mock` (mặc định, không đăng thật) hoặc `official` (đăng lên Threads thật qua graph.threads.com). |
| `TOKEN_ENCRYPTION_KEY` | khi `THREADS_PROVIDER=official` | Chuỗi base64 của 32 byte ngẫu nhiên, dùng mã hóa token Threads (AES-256-GCM). Thiếu hoặc sai thì backend không khởi động. Tạo: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. |
| `APP_ROLE` | không | `api`, `worker`, `all`. Với `api`, tiến trình không đặt nhịp worker. Lưu ý: tiến trình `api` vẫn đăng ký bộ xử lý hàng đợi; vì việc đăng bài được nhận bằng cập nhật có điều kiện trong PostgreSQL nên chạy nhiều tiến trình vẫn không đăng trùng. |

## 2. Các tiến trình nền

Cùng một mã, chạy trong tiến trình NestJS:

- **Đăng bài** (hàng đợi `publishing`): mỗi 30 giây đăng các việc đã đến giờ và dọn việc kẹt.
- **Quét giấy phép media** (hàng đợi `media-maintenance`): mỗi 6 giờ, cập nhật trạng thái lưu (hết hạn, sắp hết hạn) cho mọi tổ chức. Chỉ là bản lưu tạm cho danh sách; QA và việc đăng bài luôn tự tính lại.

Mất Redis: lịch không mất (nằm ở PostgreSQL), việc đăng chỉ chậm lại cho tới khi Redis trở lại.

## 3. Xử lý sự cố đăng bài

| Hiện tượng | Ý nghĩa | Việc cần làm |
|---|---|---|
| Bài `BLOCKED` sau khi lên lịch | Ngay trước giờ đăng, link, giấy phép hoặc tài khoản không còn hợp lệ. Bài KHÔNG được đăng. | Đọc lý do ở trang bài, sửa nguyên nhân, đưa bài về nháp, duyệt lại. |
| Bài `FAILED`, lỗi "chưa được gửi đi" | Chắc chắn chưa gửi lên Threads. | Bấm "Thử đăng lại". |
| Bài `FAILED`, "không rõ bài đã lên chưa" | Hết thời gian chờ hoặc việc kẹt quá 10 phút. Bài có thể đã lên. | Mở Threads kiểm tra. Nếu chưa có bài: thử lại kèm xác nhận. Nếu đã có: dùng mục "Bài thực ra đã có trên Threads", dán link bài (không thử lại, tránh đăng trùng). |
| Việc nằm `QUEUED` mãi | Agent "Đăng bài" đang tạm dừng, hoặc không có tiến trình worker. | Bỏ tạm dừng ở Văn phòng AI; kiểm tra tiến trình chạy `APP_ROLE=worker` hoặc `all`. Ở dev có thể gọi `POST /organizations/:orgId/publishing/run-due`. |

| Bài đã đăng nhưng comment link `FAILED`, "thử lại an toàn" | Comment chắc chắn chưa lên. | Bấm "Đăng lại comment". Bài chính không bị đăng lại. |
| Comment link `FAILED`, "không rõ" | Mất kết nối hoặc kẹt quá 10 phút. Comment có thể đã lên. | Mở Threads kiểm tra. Chưa có: "Đăng lại comment" kèm xác nhận. Đã có: "Comment thực ra đã có". |
| Tài khoản `NEEDS_REAUTH` | Threads trả lỗi xác thực (token hết hạn ~60 ngày, bị thu hồi, thiếu quyền). Các bài chờ đăng của tài khoản này sẽ bị chặn. | Vào Tài khoản Threads, nhập lại token mới để kết nối lại, rồi thử lại bài. |

Thông tin lỗi lưu ở `publish_jobs.last_error` và `published_posts.comment_error` và nhật ký `audit_logs` (`publish.*`).

## 4. Khóa API

- Khóa Claude chỉ nằm trong `.env` của backend. `.env` đã nằm trong `.gitignore`.
- Lộ khóa (dán vào chat, commit nhầm): xóa khóa trong Anthropic Console, tạo khóa mới, cập nhật `.env`, khởi động lại. Khóa đã commit vẫn nằm trong lịch sử git, nên xóa khóa ở Console mới là bước bắt buộc.
- Lỗi khi gọi Claude được chuyển thành 503/502 với thông báo chung, không kèm khóa hay nội dung lỗi gốc.
- Đặt hạn mức chi tiêu hằng tháng ở workspace riêng trên Console.

### Đăng Threads thật (THREADS_PROVIDER=official)

- Mỗi bài gồm hai lần gọi: bài chính (nội dung + dòng công khai hoa hồng) rồi comment chứa link affiliate.
- Threads **không có khóa chống trùng**. Hệ thống chỉ thử lại tự động khi chắc chắn chưa gửi; mọi trường hợp mơ hồ (mất mạng, 5xx ở bước publish) đều dừng và chờ người kiểm tra.
- Token lưu mã hóa trong bảng `social_account_credentials`, không có API nào trả ra, bị xóa khi ngắt kết nối. Không ghi token vào log, nhật ký hay thông báo lỗi.
- Đổi hoặc mất `TOKEN_ENCRYPTION_KEY`: không giải mã được token cũ, các bài sẽ thất bại "chưa gửi đi" cho đến khi kết nối lại từng tài khoản. Chưa hỗ trợ xoay khóa tự động.
- Chưa tự gia hạn token (60 ngày) và chưa có đăng nhập OAuth: dán token dài hạn lấy từ Meta for Developers.

## 5. Sao lưu

Dữ liệu nghiệp vụ nằm hết ở PostgreSQL. Ví dụ sao lưu và khôi phục (chưa được chạy thử trong quá trình viết):

```
docker compose exec postgres pg_dump -U "$DB_USER" -Fc "$DB_NAME" > ace-$(date +%F).dump
docker compose exec -T postgres pg_restore -U "$DB_USER" -d "$DB_NAME" --clean --if-exists < ace-YYYY-MM-DD.dump
```

Hãy thử khôi phục vào một database trống trước khi tin vào bản sao lưu.

## 6. Kiểm tra tự động (CI)

`.github/workflows/ci.yml` chạy khi đẩy mã: typecheck, test, build cho backend và frontend; migration lên, hoàn tác từng bước, chạy lại trên PostgreSQL thật; khởi động API thật và gọi `/api/v1/health/ready` (kiểm tra mọi module và hàng đợi khởi tạo được). Cần commit `package-lock.json` của `backend` và `frontend` để dùng `npm ci`; nếu chưa có thì CI dùng `npm install`. Tệp này chưa được chạy trên GitHub khi viết: lần chạy đầu là lần kiểm chứng, nếu đỏ hãy gửi log để sửa.

## 7. Giới hạn hiện tại

- Đăng Threads thật mới chạy thử được ở chế độ Meta Developer (tài khoản tester), chưa được kiểm chứng trên Threads thật trong CI; chỉ đăng văn bản (chưa đăng kèm ảnh). Không lấy được số liệu hay đơn hàng từ API (nhập tay hoặc CSV).
- Media: chưa có kho tệp; chỉ quản lý giấy phép và đường dẫn nguồn.
- Chưa có Dockerfile và cấu hình triển khai production.

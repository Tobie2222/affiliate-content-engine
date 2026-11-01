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
| `SHOPEE_PROVIDER`, `THREADS_PROVIDER` | không | Hiện chỉ `mock` dùng được. `official` bị từ chối rõ ràng (chưa có tích hợp thật). |
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
| Bài `FAILED`, "không rõ bài đã lên chưa" | Hết thời gian chờ hoặc việc kẹt quá 10 phút. Bài có thể đã lên. | Mở Threads kiểm tra. Nếu chưa có bài: thử lại kèm xác nhận. Nếu đã có: không thử lại (đăng thật chưa có chức năng "đánh dấu đã đăng" nên cần xử lý tay trong DB). |
| Việc nằm `QUEUED` mãi | Agent "Đăng bài" đang tạm dừng, hoặc không có tiến trình worker. | Bỏ tạm dừng ở Văn phòng AI; kiểm tra tiến trình chạy `APP_ROLE=worker` hoặc `all`. Ở dev có thể gọi `POST /organizations/:orgId/publishing/run-due`. |

Thông tin lỗi lưu ở `publish_jobs.last_error` và nhật ký `audit_logs` (`publish.*`).

## 4. Khóa API

- Khóa Claude chỉ nằm trong `.env` của backend. `.env` đã nằm trong `.gitignore`.
- Lộ khóa (dán vào chat, commit nhầm): xóa khóa trong Anthropic Console, tạo khóa mới, cập nhật `.env`, khởi động lại. Khóa đã commit vẫn nằm trong lịch sử git, nên xóa khóa ở Console mới là bước bắt buộc.
- Lỗi khi gọi Claude được chuyển thành 503/502 với thông báo chung, không kèm khóa hay nội dung lỗi gốc.
- Đặt hạn mức chi tiêu hằng tháng ở workspace riêng trên Console.

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

- Không đăng được lên Threads thật, không lấy được số liệu hay đơn hàng từ API (chỉ giả lập, nhập tay, nhập CSV).
- Media: chưa có kho tệp; chỉ quản lý giấy phép và đường dẫn nguồn.
- Chưa có chức năng "đánh dấu bài đã đăng thủ công" khi kết quả không rõ.
- Chưa có Dockerfile và cấu hình triển khai production.

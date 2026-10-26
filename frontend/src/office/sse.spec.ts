import { createSseParser } from './sse';

function collect(chunks: string[]): string[] {
  const out: string[] = [];
  const parser = createSseParser((d) => out.push(d));
  chunks.forEach((c) => parser.push(c));
  return out;
}

describe('createSseParser', () => {
  it('đọc một sự kiện hoàn chỉnh', () => {
    expect(collect(['data: {"a":1}\n\n'])).toEqual(['{"a":1}']);
  });

  it('ghép sự kiện bị cắt thành nhiều mảnh, kể cả cắt giữa dòng', () => {
    expect(collect(['da', 'ta: {"a"', ':1}\n', '\n'])).toEqual(['{"a":1}']);
  });

  it('đọc nhiều sự kiện trong cùng một mảnh', () => {
    expect(collect(['data: 1\n\ndata: 2\n\n'])).toEqual(['1', '2']);
  });

  it('nối nhiều dòng data bằng xuống dòng', () => {
    expect(collect(['data: dòng 1\ndata: dòng 2\n\n'])).toEqual(['dòng 1\ndòng 2']);
  });

  it('xử lý CRLF, kể cả khi \\r và \\n nằm ở hai mảnh khác nhau', () => {
    expect(collect(['data: x\r\n\r\n'])).toEqual(['x']);
    expect(collect(['data: y\r', '\n\r', '\n'])).toEqual(['y']);
  });

  it('bỏ qua dòng chú thích và các trường khác', () => {
    expect(collect([': ping\n\nevent: message\nid: 7\nretry: 100\ndata: z\n\n'])).toEqual(['z']);
  });

  it('không phát sự kiện khi chưa có dòng trống kết thúc', () => {
    expect(collect(['data: chưa xong\n'])).toEqual([]);
  });

  it('bỏ một dấu cách đầu giá trị và chấp nhận dòng data không có dấu cách', () => {
    expect(collect(['data:abc\n\n', 'data:  hai\n\n'])).toEqual(['abc', ' hai']);
  });

  it('dòng trống liên tiếp không tạo sự kiện rỗng', () => {
    expect(collect(['\n\n\ndata: 1\n\n\n'])).toEqual(['1']);
  });

  it('giữ nguyên ký tự tiếng Việt', () => {
    expect(collect(['data: Đang viết bài\n\n'])).toEqual(['Đang viết bài']);
  });
});

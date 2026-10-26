/**
 * Bộ đọc luồng Server-Sent Events. Dùng với fetch (EventSource của trình duyệt không gửi được
 * header Authorization). Nhận từng mảnh văn bản, gọi onData cho mỗi sự kiện hoàn chỉnh.
 */
export interface SseParser {
  push(chunk: string): void;
}

export function createSseParser(onData: (data: string) => void): SseParser {
  let buffer = '';
  let dataLines: string[] = [];

  const handleLine = (line: string): void => {
    if (line === '') {
      if (dataLines.length > 0) {
        const data = dataLines.join('\n');
        dataLines = [];
        onData(data);
      }
      return;
    }
    if (line.startsWith(':')) {
      return; // dòng chú thích / heartbeat
    }
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) {
      value = value.slice(1);
    }
    if (field === 'data') {
      dataLines.push(value);
    }
    // Các trường khác (event, id, retry) chưa dùng.
  };

  return {
    push(chunk: string): void {
      buffer += chunk;
      // Chuẩn hóa xuống dòng; giữ lại dấu \r đứng cuối vì có thể là nửa đầu của \r\n.
      buffer = buffer.replace(/\r\n/g, '\n').replace(/\r(?!$)/g, '\n');
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      lines.forEach(handleLine);
    },
  };
}

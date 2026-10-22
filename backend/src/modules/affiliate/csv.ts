export class CsvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CsvError';
  }
}

export interface CsvRow {
  /** Số dòng bắt đầu của bản ghi trong tệp (tiêu đề là dòng 1). */
  line: number;
  values: Record<string, string>;
}

export interface CsvParseResult {
  headers: string[];
  rows: CsvRow[];
}

/**
 * Đọc CSV theo RFC 4180: dấu phẩy phân cách, giá trị có thể bọc trong "..." (có thể chứa
 * dấu phẩy, xuống dòng, và "" để biểu diễn một dấu "). Chấp nhận CRLF và BOM UTF-8.
 * Tên cột được chuẩn hóa về chữ thường. Ném CsvError khi tệp sai cấu trúc.
 */
export function parseCsv(input: string): CsvParseResult {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;

  const records: Array<{ line: number; cells: string[] }> = [];
  let cells: string[] = [];
  let field = '';
  let inQuotes = false;
  let fieldStart = true;
  let afterQuote = false;
  let line = 1;
  let recordLine = 1;

  const endField = (): void => {
    cells.push(field);
    field = '';
    fieldStart = true;
    afterQuote = false;
  };
  const endRecord = (): void => {
    endField();
    // Bỏ qua dòng trống hoàn toàn.
    if (!(cells.length === 1 && cells[0].trim() === '')) {
      records.push({ line: recordLine, cells });
    }
    cells = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
          afterQuote = true;
        }
      } else {
        if (ch === '\n') line++;
        field += ch;
      }
      continue;
    }

    if (afterQuote && ch !== ',' && ch !== '\n' && ch !== '\r') {
      throw new CsvError(`Có ký tự thừa sau dấu nháy đóng ở dòng ${line}.`);
    }
    if (ch === '"') {
      if (!fieldStart) {
        throw new CsvError(`Dấu nháy xuất hiện giữa giá trị ở dòng ${line}.`);
      }
      inQuotes = true;
      fieldStart = false;
      continue;
    }
    if (ch === ',') {
      endField();
      continue;
    }
    if (ch === '\r') {
      continue;
    }
    if (ch === '\n') {
      endRecord();
      line++;
      recordLine = line;
      continue;
    }
    field += ch;
    fieldStart = false;
  }

  if (inQuotes) {
    throw new CsvError('Có dấu nháy mở nhưng chưa đóng.');
  }
  if (field !== '' || cells.length > 0 || afterQuote) {
    endRecord();
  }

  if (records.length === 0) {
    throw new CsvError('Tệp CSV rỗng.');
  }

  const headers = records[0].cells.map((h) => h.trim().toLowerCase());
  if (headers.some((h) => h === '')) {
    throw new CsvError('Dòng tiêu đề có cột không có tên.');
  }
  if (new Set(headers).size !== headers.length) {
    throw new CsvError('Dòng tiêu đề có tên cột bị trùng.');
  }

  const rows: CsvRow[] = records.slice(1).map((record) => {
    if (record.cells.length > headers.length) {
      throw new CsvError(
        `Dòng ${record.line} có ${record.cells.length} cột, nhiều hơn tiêu đề (${headers.length} cột).`,
      );
    }
    const values: Record<string, string> = {};
    headers.forEach((header, index) => {
      values[header] = record.cells[index] ?? '';
    });
    return { line: record.line, values };
  });

  return { headers, rows };
}

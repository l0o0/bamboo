export interface InsertTemplate {
  text: string;
  selectionFrom: number;
  selectionTo: number;
}

const TABLE_PICKER_LIMIT = 8;

function tableRow(cells: string[]) {
  return `| ${cells.join(" | ")} |`;
}

export function tableInsertTemplate(rows = 3, columns = 3): InsertTemplate {
  const safeRows = Math.min(
    TABLE_PICKER_LIMIT,
    Math.max(1, Math.trunc(rows) || 3),
  );
  const safeColumns = Math.min(
    TABLE_PICKER_LIMIT,
    Math.max(1, Math.trunc(columns) || 3),
  );
  const header = Array.from(
    { length: safeColumns },
    (_, index) => `Column ${index + 1}`,
  );
  const delimiter = Array.from({ length: safeColumns }, () => "---");
  const body = Array.from({ length: safeRows - 1 }, () =>
    tableRow(Array.from({ length: safeColumns }, () => "Cell")),
  );
  return {
    text: [tableRow(header), tableRow(delimiter), ...body].join("\n"),
    selectionFrom: 2,
    selectionTo: 10,
  };
}

export function imageInsertTemplate(): InsertTemplate {
  return {
    text: "![alt](url)",
    selectionFrom: 2,
    selectionTo: 5,
  };
}

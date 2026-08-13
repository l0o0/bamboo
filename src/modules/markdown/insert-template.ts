export interface InsertTemplate {
  text: string;
  selectionFrom: number;
  selectionTo: number;
}

export function tableInsertTemplate(): InsertTemplate {
  return {
    text: "| Column 1 | Column 2 |\n| --- | --- |\n| Cell | Cell |",
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

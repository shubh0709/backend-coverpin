export interface ValidationError {
  file: string;
  line: number;
  column: string;
  message: string;
}

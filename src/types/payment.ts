export interface Payment {
  id: number;
  bank: string;          // Banco
  account?: string;      // Conta (se tiver)
  description: string;   // Descrição
  dueDate: string;       // Vencimento (ISO: 2025-12-10)
  amount: number;        // Valor em reais
  paid: boolean;         // true/false
  paidAt?: string | null;
  category?: string | null;
}

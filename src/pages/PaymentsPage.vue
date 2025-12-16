<template>
  <section class="page">
    <div class="page-header">
      <h2>Pagamentos do mês</h2>

      <div class="filters">
        <label class="filter-item">
          <span>Mês de referência:</span>
          <input
            type="month"
            v-model="selectedMonth"
            @change="loadPayments"
          />
        </label>

        <button
          class="btn"
          type="button"
          @click="loadPayments"
          :disabled="isLoading"
        >
          {{ isLoading ? "Carregando..." : "Atualizar" }}
        </button>
      </div>
    </div>

    <div class="summary">
      <div class="card">
        <span class="label">Total</span>
        <strong>{{ formatCurrency(totalAmount) }}</strong>
      </div>

      <div class="card card-paid">
        <span class="label">Pago</span>
        <strong>{{ formatCurrency(paidAmount) }}</strong>
      </div>

      <div class="card card-open">
        <span class="label">Em aberto</span>
        <strong>{{ formatCurrency(openAmount) }}</strong>
      </div>
    </div>

    <div v-if="error" class="error">
      {{ error }}
    </div>

    <div class="table-wrapper" v-if="payments.length">
      <table>
        <thead>
          <tr>
            <th>Banco</th>
            <th>Descrição</th>
            <th>Vencimento</th>
            <th>Valor</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="payment in payments" :key="payment.id">
            <td>{{ payment.bank }}</td>
            <td>{{ payment.description }}</td>
            <td>{{ formatDate(payment.dueDate) }}</td>
            <td>{{ formatCurrency(payment.amount) }}</td>
            <td>
              <span
                class="tag"
                :class="payment.paid ? 'tag-paid' : 'tag-open'"
              >
                {{ payment.paid ? "Pago" : "Em aberto" }}
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <p v-else-if="!isLoading && !error" class="empty">
      Nenhum pagamento encontrado para esse mês.
    </p>
  </section>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import api from "../services/api";
import type { Payment } from "../types/payment";

const payments = ref<Payment[]>([]);
const isLoading = ref(false);
const error = ref<string | null>(null);

// Mês atual no formato YYYY-MM
const today = new Date();
const initialMonth = `${today.getFullYear()}-${String(
  today.getMonth() + 1
).padStart(2, "0")}`;

const selectedMonth = ref(initialMonth);

const totalAmount = computed(() =>
  payments.value.reduce((acc, p) => acc + (p.amount || 0), 0)
);

const paidAmount = computed(() =>
  payments.value
    .filter((p) => p.paid)
    .reduce((acc, p) => acc + (p.amount || 0), 0)
);

const openAmount = computed(() => totalAmount.value - paidAmount.value);

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value || 0);
}

function formatDate(dateStr: string): string {
  if (!dateStr) return "-";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("pt-BR");
}

async function loadPayments() {
  try {
    isLoading.value = true;
    error.value = null;

    const { data } = await api.get<Payment[]>("/payments", {
      params: {
        month: selectedMonth.value,
      },
    });

    payments.value = data;
  } catch (e) {
    console.error(e);
    error.value =
      "Não foi possível carregar os pagamentos. Verifique a API ou tente novamente.";
  } finally {
    isLoading.value = false;
  }
}

onMounted(() => {
  loadPayments();
});
</script>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.page-header {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 1rem;
  align-items: center;
}

.page-header h2 {
  margin: 0;
  font-size: 1.25rem;
}

.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: center;
}

.filter-item {
  display: flex;
  flex-direction: column;
  font-size: 0.875rem;
}

.filter-item input[type="month"] {
  margin-top: 0.25rem;
  padding: 0.25rem 0.5rem;
  border-radius: 0.375rem;
  border: 1px solid #4b5563;
  background: #020617;
  color: #e5e7eb;
}

.btn {
  padding: 0.5rem 1rem;
  border-radius: 0.5rem;
  border: none;
  cursor: pointer;
  background: #2563eb;
  color: white;
  font-weight: 500;
}

.btn:disabled {
  opacity: 0.6;
  cursor: default;
}

.summary {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 0.75rem;
}

.card {
  padding: 0.75rem 1rem;
  border-radius: 0.75rem;
  background: #020617;
  border: 1px solid #1f2937;
}

.card-paid {
  border-color: #16a34a;
}

.card-open {
  border-color: #f97316;
}

.card .label {
  font-size: 0.75rem;
  color: #9ca3af;
}

.card strong {
  display: block;
  margin-top: 0.25rem;
  font-size: 1rem;
}

.error {
  padding: 0.75rem 1rem;
  border-radius: 0.75rem;
  background: #7f1d1d;
  color: #fee2e2;
  font-size: 0.875rem;
}

.table-wrapper {
  border-radius: 0.75rem;
  overflow: auto;
  border: 1px solid #1f2937;
}

table {
  width: 100%;
  border-collapse: collapse;
  min-width: 600px;
  background: #020617;
}

th,
td {
  padding: 0.5rem 0.75rem;
  text-align: left;
  font-size: 0.875rem;
  border-bottom: 1px solid #111827;
}

th {
  background: #020617;
  position: sticky;
  top: 0;
  z-index: 1;
}

.tag {
  padding: 0.125rem 0.5rem;
  border-radius: 9999px;
  font-size: 0.75rem;
}

.tag-paid {
  background: #16a34a33;
  color: #bbf7d0;
}

.tag-open {
  background: #f9731633;
  color: #fed7aa;
}

.empty {
  font-size: 0.875rem;
  color: #9ca3af;
}
</style>

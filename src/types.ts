export interface GlobalSettings {
  renovationFund: number;
  initialBalance: number;
  lastUpdated: string;
}

export interface FinanceEntry {
  id: string;
  date: string;
  name: string;
  person: string; // Recipient for expenses, Sender for income
  description: string;
  amount: number;
  type: 'income' | 'expense';
  isAutomatic?: boolean;
  billingPeriodId?: string;
}

export interface ResidentMeter {
  id?: string;
  name: string;
  initialReading: number;
}

export interface Resident {
  id: string;
  name: string;
  apartmentNumber: string;
  email: string;
  phone: string;
  meters: ResidentMeter[];
}

export interface BillingPeriod {
  id: string;
  month: string; // YYYY-MM
  mainMeterStart: number;
  mainMeterEnd: number;
  totalConsumption: number;
  totalInvoiceAmount: number;
  pricePerM3: number;
  elecMeterStart: number;
  elecMeterEnd: number;
  elecTotalConsumption: number;
  elecTotalInvoiceAmount: number;
  elecPricePerKWh: number;
  renovationFundAtTime: number;
  status: 'draft' | 'published';
  invoicePeriodStart?: string;
  invoicePeriodEnd?: string;
}

export interface MeterReading {
  startReading: number;
  endReading: number;
  consumption: number;
}

export interface Reading {
  id: string;
  billingPeriodId: string;
  residentId: string;
  meterReadings: MeterReading[];
  meterConsumption: number;
  waterLossShare: number;
  waterLossCost: number;
  totalConsumption: number;
  waterReading: number;
  elecReading: number;
  waterUsage: number;
  elecUsage: number;
  waterCost: number;
  elecCost: number;
  repairFund: number;
  totalToPay: number;
  paidAmount?: number;
  paymentDate?: string;
  lastUpdated?: string;
}

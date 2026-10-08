export interface User {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
}

export interface AuthResponse {
  user: User;
  token: string;
}

export interface Friend {
  userId: string;
  email: string;
  displayName: string;
  addedAt: string;
}

export interface GroupSummary {
  id: string;
  name: string;
  createdBy: string;
  createdAt: string;
  memberCount: number;
}

export interface GroupMember {
  userId: string;
  displayName: string;
  email: string;
  joinedAt: string;
}

export interface GroupDetail extends GroupSummary {
  members: GroupMember[];
}

export type SplitMethod = "EQUAL" | "UNEQUAL" | "PERCENTAGE";

export interface ExpenseParticipant {
  userId: string;
  shareCents: number;
  share: string;
  splitInput: number | null;
}

export interface ExpenseDetail {
  id: string;
  groupId: string;
  description: string;
  amountCents: number;
  amount: string;
  paidByUserId: string;
  expenseDate: string;
  splitMethod: SplitMethod;
  createdBy: string;
  createdAt: string;
  participants: ExpenseParticipant[];
}

export interface MemberBalance {
  userId: string;
  displayName: string;
  paidCents: number;
  shareCents: number;
  netCents: number;
  paid: string;
  share: string;
  net: string;
}

export interface SettlementDetail {
  id: string;
  groupId: string;
  fromUserId: string;
  fromDisplayName: string;
  toUserId: string;
  toDisplayName: string;
  amountCents: number;
  amount: string;
  status: "PENDING" | "COMPLETED";
  createdAt: string;
  completedAt: string | null;
}

export interface GroupSummaryPayload {
  groupId: string;
  totalSpentCents: number;
  totalSpent: string;
  members: Array<{
    userId: string;
    displayName: string;
    paidCents: number;
    shareCents: number;
    netCents: number;
    outstandingNetCents: number;
    paid: string;
    share: string;
    net: string;
    outstandingNet: string;
  }>;
  settlements: SettlementDetail[];
}

export interface ApiErrorBody {
  error: { message: string; code?: string };
}

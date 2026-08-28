export type SessionUser = {
  id: number;
  fullName: string;
  email: string;
  mobile: string;
  gender: string;
  dateOfBirth: string | null;
  role: string;
  status: string;
  emailVerified: boolean;
};

export type ProfileCardData = {
  userId: number;
  profileId: number;
  fullName: string;
  gender: string;
  dateOfBirth: string | null;
  age: number | null;
  location: string | null;
  profession: string | null;
  education: string | null;
  religion: string | null;
  community: string | null;
  motherTongue: string | null;
  maritalStatus: string | null;
  income: number | null;
  heightCm: number | null;
  about: string | null;
  headline: string | null;
  profilePhotoUrl: string | null;
  approvalStatus: string;
  verificationStatus: string;
  visibility: string;
  createdAt: Date;
  matchPercent?: number;
};

export type MiniProfile = {
  userId: number;
  fullName: string;
  age: number | null;
  location: string | null;
  profession: string | null;
  education: string | null;
  profilePhotoUrl: string | null;
  verificationStatus: string;
};

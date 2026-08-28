import { MemberPageLoader } from "@/features/members/components/member-page-loader";

export default function MembersPage() {
  return (
    <div className="-mx-4 -mt-[calc(1rem+env(safe-area-inset-top))] min-h-dvh bg-surface px-4 pt-[calc(1rem+env(safe-area-inset-top))] min-[481px]:-mx-6 min-[481px]:px-6">
      <MemberPageLoader />
    </div>
  );
}

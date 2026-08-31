const colors = ["mint", "blue", "orange", "rose", "violet", "leaf"] as const;

function stableIndex(value: string, length: number): number {
  let hash = 0;
  for (const character of value) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return hash % length;
}

/** member UUID 决定固定插画和底色，访客改名不会让头像跳变。 */
export function MemberAvatar({ memberId, displayName, size = "md" }: { memberId: string; displayName: string; size?: "sm" | "md" }) {
  const index = stableIndex(memberId, colors.length);
  return (
    <span className={`avatar avatar--${size} avatar--${colors[index]}`} role="img" aria-label={`${displayName}的头像`}>
      <img src={`/member-avatars/avatar-0${index + 1}.webp`} width={40} height={40} alt="" />
    </span>
  );
}

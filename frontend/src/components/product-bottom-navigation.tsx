import { Bell, UserRound, UsersRound } from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import { useSessionQuery } from "../features/auth/api";
import { useNotificationsQuery } from "../features/notifications/api";

export function ProductBottomNavigation() {
  const location = useLocation();
  const session = useSessionQuery();
  const notifications = useNotificationsQuery(session.data?.userId ?? "");
  const unreadCount = notifications.data?.unreadCount ?? 0;
  const items = [
    { to: "/activities", label: "活动", Icon: UsersRound },
    { to: "/notifications", label: "通知", Icon: Bell },
    { to: "/me", label: "我的", Icon: UserRound },
  ];
  return (
    <nav className="product-bottom-nav" aria-label="主导航">
      <ul>
        {items.map(({ to, label, Icon }) => (
          <li key={to}>
            <NavLink
              to={to}
              aria-label={to === "/notifications" && unreadCount > 0 ? `${label}，${unreadCount} 条未读` : label}
              className={({ isActive }) =>
                isActive || location.pathname.startsWith(`${to}/`) ? "active" : ""
              }
            >
              <span className="product-bottom-nav__icon"><Icon aria-hidden="true" size={20} />{to === "/notifications" && unreadCount > 0 ? <span className="product-bottom-nav__badge" aria-hidden="true" /> : null}</span>
              <span>{label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

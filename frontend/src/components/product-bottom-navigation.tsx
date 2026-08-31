import { Bell, UserRound, UsersRound } from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";

export function ProductBottomNavigation() {
  const location = useLocation();
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
              className={({ isActive }) =>
                isActive || location.pathname.startsWith(`${to}/`) ? "active" : ""
              }
            >
              <Icon aria-hidden="true" size={20} />
              <span>{label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

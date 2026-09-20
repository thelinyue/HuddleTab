import { UserRound, UsersRound } from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";

export function ProductBottomNavigation() {
  const location = useLocation();
  // “我的”下级页面和系统管理页拥有自己的返回入口；路由切换后立即移除悬浮胶囊，避免遮挡表单和设置内容。
  const isSecondaryPage = location.pathname.startsWith("/me/") || location.pathname === "/admin" || location.pathname.startsWith("/admin/");
  if (isSecondaryPage) return null;
  const items = [
    { to: "/activities", label: "活动", Icon: UsersRound },
    { to: "/me", label: "我的", Icon: UserRound },
  ];
  return (
    <nav className="product-bottom-nav" aria-label="主导航">
      <ul>
        {items.map(({ to, label, Icon }) => (
          <li key={to}>
            <NavLink
              to={to}
              aria-label={label}
              className={({ isActive }) =>
                isActive || location.pathname.startsWith(`${to}/`) || (to === "/me" && location.pathname.startsWith("/admin")) ? "active" : ""
              }
            >
              <span className="product-bottom-nav__icon"><Icon aria-hidden="true" size={20} /></span>
              <span>{label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

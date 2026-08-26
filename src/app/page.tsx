/** 应用启动入口；认证完成后将由活动列表替换此初始状态。 */
export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-3xl flex-col justify-center px-5 py-12 sm:px-8">
      <p className="text-sm font-semibold">HuddleTab</p>
      <h1 className="mt-2 text-4xl font-extrabold">伙记</h1>
      <p className="mt-3 text-lg">一起花，清楚分。</p>
    </main>
  );
}

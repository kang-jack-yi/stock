/** 路由加载边界使用 CSS 骨架，不引入额外客户端包。 */
export default function Loading() {
  return (
    <div className="route-loading" role="status" aria-label="页面加载中">
      <div />
      <div />
      <div />
      <div />
    </div>
  );
}

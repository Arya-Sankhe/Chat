export function MovedNotice() {
  return (
    <aside className="ios-install-hint hidden" id="movedNotice" role="status" aria-labelledby="movedNoticeTitle">
      <button className="ios-install-close" id="movedNoticeDismiss" type="button" aria-label="Dismiss moved notice">x</button>
      {" "}
      <img src="/icons/icon-192.png?v=20260825-icon" width="44" height="44" alt="" />
      {" "}
      <div>
        <strong id="movedNoticeTitle">Klui lives at Klui.ai now</strong>
        {" "}
        <p>You came from Klui.tech. Same account, same chats.</p>
        {" "}
        <button className="moved-open" id="movedNoticeOpen" type="button">Open Klui</button>
      </div>
    </aside>
  );
}

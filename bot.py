import asyncio
import csv
import logging
import os
import sqlite3
from contextlib import closing
from datetime import datetime
from pathlib import Path
from typing import Any

from telegram import (
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    KeyboardButton,
    ReplyKeyboardMarkup,
    ReplyKeyboardRemove,
    Update,
)
from telegram.constants import ParseMode
from telegram.ext import (
    Application,
    CallbackQueryHandler,
    CommandHandler,
    ContextTypes,
    MessageHandler,
    filters,
)

logging.basicConfig(
    format="%(asctime)s | %(name)s | %(levelname)s | %(message)s",
    level=logging.INFO,
)
logger = logging.getLogger(__name__)

DATE_FMT = "%Y-%m-%d"
TIME_FMT = "%H:%M"
DATETIME_FMT = "%Y-%m-%d %H:%M:%S"

REQUEST_STATUSES = {"요청", "수락", "거절", "취소", "무응답", "완료", "미이행"}
REQUESTER_ALLOWED_COMMANDS = {"/start", "/help", "/request", "/my_requests", "/reason"}
CAREGIVER_ALLOWED_COMMANDS = {"/start", "/help", "/menu", "/list", "/yearly", "/export_yearly"}

PENDING_INPUTS: dict[int, dict[str, Any]] = {}


def now_str() -> str:
    return datetime.now().strftime(DATETIME_FMT)


def get_caregiver_chat_id() -> int:
    raw = os.getenv("ADMIN_CHAT_ID", "").strip()
    if not raw:
        raise RuntimeError("환경변수 ADMIN_CHAT_ID 가 필요합니다.")
    return int(raw)


def is_caregiver(chat_id: int) -> bool:
    return chat_id == get_caregiver_chat_id()


def is_allowed_command(chat_id: int, text: str) -> bool:
    command = text.strip().split(maxsplit=1)[0].lower()
    return command in (CAREGIVER_ALLOWED_COMMANDS if is_caregiver(chat_id) else REQUESTER_ALLOWED_COMMANDS)


def parse_request_args(text: str) -> tuple[str, str, str, str]:
    parts = text.strip().split(maxsplit=4)
    if len(parts) < 4:
        raise ValueError("형식: /request YYYY-MM-DD HH:MM 장소 요청메시지")
    requested_date = parts[1]
    requested_time = parts[2]
    requested_place = parts[3]
    request_message = parts[4] if len(parts) >= 5 else ""
    datetime.strptime(requested_date, DATE_FMT)
    datetime.strptime(requested_time, TIME_FMT)
    return requested_date, requested_time, requested_place, request_message


def parse_datetime_flexible(text: str) -> tuple[str, str]:
    raw = " ".join(text.strip().split())
    patterns = [
        "%Y-%m-%d %H:%M",
        "%Y.%m.%d %H:%M",
        "%Y/%m/%d %H:%M",
        "%Y-%m-%d %H시 %M분",
        "%Y.%m.%d %H시 %M분",
        "%Y/%m/%d %H시 %M분",
        "%Y-%m-%d %H시",
        "%Y.%m.%d %H시",
        "%Y/%m/%d %H시",
    ]
    for pattern in patterns:
        try:
            dt = datetime.strptime(raw, pattern)
            return dt.strftime(DATE_FMT), dt.strftime(TIME_FMT)
        except ValueError:
            continue
    raise ValueError("일시는 예: 2026-04-20 14:00 또는 2026.04.20 14시 형식으로 입력하세요.")


def parse_year(text: str) -> str:
    datetime.strptime(text, "%Y")
    return text


def parse_approval_input(text: str) -> tuple[str, str]:
    raw = " ".join(text.strip().split())
    if "|" in raw:
        approved_place, approved_time = [x.strip() for x in raw.split("|", 1)]
    else:
        parts = raw.rsplit(" ", 1)
        if len(parts) != 2:
            raise ValueError("예: 경주역 2번 출구 14:00 또는 경주역 2번 출구 | 14:00")
        approved_place, approved_time = parts[0].strip(), parts[1].strip()

    if not approved_place:
        raise ValueError("장소가 비어 있습니다.")

    datetime.strptime(approved_time, TIME_FMT)
    return approved_place, approved_time


def create_request(
    requester_chat_id: int,
    requester_name: str,
    requested_date: str,
    requested_time: str,
    requested_place: str,
    request_message: str,
) -> int:
    with closing(get_conn()) as conn:
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO visitation_requests (
                requester_chat_id, requester_name, requested_date, requested_time,
                requested_place, request_message, status, approved_place, approved_time,
                caregiver_reason, requester_reason, execution_note, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, '요청', '', '', '', '', '', ?, ?)
            """,
            (
                requester_chat_id,
                requester_name,
                requested_date,
                requested_time,
                requested_place,
                request_message,
                now_str(),
                now_str(),
            ),
        )
        conn.commit()
        return int(cur.lastrowid)


def get_request(request_id: int):
    with closing(get_conn()) as conn:
        cur = conn.cursor()
        cur.execute("SELECT * FROM visitation_requests WHERE id = ?", (request_id,))
        return cur.fetchone()


def get_recent_requests(limit: int = 10):
    with closing(get_conn()) as conn:
        cur = conn.cursor()
        cur.execute("SELECT * FROM visitation_requests ORDER BY id DESC LIMIT ?", (limit,))
        return cur.fetchall()


def get_year_requests(year: str):
    with closing(get_conn()) as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT * FROM visitation_requests WHERE substr(requested_date, 1, 4) = ? ORDER BY requested_date ASC, id ASC",
            (year,),
        )
        return cur.fetchall()


def get_requests_for_requester(chat_id: int, limit: int = 10):
    with closing(get_conn()) as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT * FROM visitation_requests WHERE requester_chat_id = ? ORDER BY id DESC LIMIT ?",
            (chat_id, limit),
        )
        return cur.fetchall()


def set_approval(request_id: int, approved_place: str, approved_time: str) -> None:
    with closing(get_conn()) as conn:
        conn.execute(
            "UPDATE visitation_requests SET status = '수락', approved_place = ?, approved_time = ?, updated_at = ? WHERE id = ?",
            (approved_place, approved_time, now_str(), request_id),
        )
        conn.commit()


def set_status(request_id: int, status: str) -> None:
    if status not in REQUEST_STATUSES:
        raise ValueError("허용되지 않는 상태입니다.")
    with closing(get_conn()) as conn:
        conn.execute(
            "UPDATE visitation_requests SET status = ?, updated_at = ? WHERE id = ?",
            (status, now_str(), request_id),
        )
        conn.commit()


def set_caregiver_reason(request_id: int, reason: str) -> None:
    with closing(get_conn()) as conn:
        conn.execute(
            "UPDATE visitation_requests SET caregiver_reason = ?, updated_at = ? WHERE id = ?",
            (reason, now_str(), request_id),
        )
        conn.commit()


def set_requester_reason(request_id: int, reason: str) -> None:
    with closing(get_conn()) as conn:
        conn.execute(
            "UPDATE visitation_requests SET requester_reason = ?, updated_at = ? WHERE id = ?",
            (reason, now_str(), request_id),
        )
        conn.commit()


def set_execution_note(request_id: int, note: str) -> None:
    with closing(get_conn()) as conn:
        conn.execute(
            "UPDATE visitation_requests SET execution_note = ?, updated_at = ? WHERE id = ?",
            (note, now_str(), request_id),
        )
        conn.commit()


def export_year_csv(year: str) -> Path:
    path = DATA_DIR / f"visitation_requests_{year}.csv"
    rows = get_year_requests(year)
    with path.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.writer(f)
        writer.writerow([
            "ID",
            "비양육자",
            "요청일",
            "요청시간",
            "요청장소",
            "요청메시지",
            "상태",
            "확정장소",
            "확정시간",
            "양육자사유",
            "비양육자사유",
            "실행메모",
            "생성시각",
            "수정시각",
        ])
        for r in rows:
            writer.writerow([
                r["id"],
                r["requester_name"],
                r["requested_date"],
                r["requested_time"],
                r["requested_place"],
                r["request_message"],
                r["status"],
                r["approved_place"],
                r["approved_time"],
                r["caregiver_reason"],
                r["requester_reason"],
                r["execution_note"],
                r["created_at"],
                r["updated_at"],
            ])
    return path


def format_request(row: sqlite3.Row) -> str:
    return (
        f"[요청 ID {row['id']}] 상태: {row['status']}\n"
        f"비양육자: {row['requester_name']}\n"
        f"요청일시: {row['requested_date']} {row['requested_time']}\n"
        f"요청장소: {row['requested_place']}\n"
        f"요청메시지: {row['request_message'] or '-'}\n"
        f"확정장소: {row['approved_place'] or '-'}\n"
        f"확정시간: {row['approved_time'] or '-'}\n"
        f"양육자 사유: {row['caregiver_reason'] or '-'}\n"
        f"비양육자 사유: {row['requester_reason'] or '-'}\n"
        f"실행메모: {row['execution_note'] or '-'}"
    )


def build_requester_home_keyboard() -> ReplyKeyboardMarkup:
    return ReplyKeyboardMarkup(
        [
            [KeyboardButton("요청하기")],
            [KeyboardButton("내 요청 보기")],
            [KeyboardButton("사유 남기기")],
        ],
        resize_keyboard=True,
    )


def build_caregiver_home_keyboard() -> ReplyKeyboardMarkup:
    return ReplyKeyboardMarkup(
        [
            [KeyboardButton("양육자 메뉴")],
            [KeyboardButton("최근 요청 보기")],
            [KeyboardButton("연별 요약")],
            [KeyboardButton("연별 CSV")],
        ],
        resize_keyboard=True,
    )


def build_caregiver_menu() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("📋 최근 요청 보기", callback_data="menu:recent")],
        [InlineKeyboardButton("🗓️ 연별 요약", callback_data="menu:year_summary")],
        [InlineKeyboardButton("⬇️ 연별 CSV", callback_data="menu:year_export")],
    ])


def build_caregiver_actions(request_id: int) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup([
        [
            InlineKeyboardButton("수락", callback_data=f"approve:{request_id}"),
            InlineKeyboardButton("거절", callback_data=f"reason_status:{request_id}:거절"),
        ],
        [
            InlineKeyboardButton("완료", callback_data=f"execution:{request_id}:완료"),
            InlineKeyboardButton("미이행", callback_data=f"execution:{request_id}:미이행"),
        ],
        [
            InlineKeyboardButton("취소", callback_data=f"reason_status:{request_id}:취소"),
            InlineKeyboardButton("무응답", callback_data=f"reason_status:{request_id}:무응답"),
        ],
        [InlineKeyboardButton("새로고침", callback_data=f"view:{request_id}")],
    ])


def build_requester_actions(request_id: int) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("비양육자 사유 남기기", callback_data=f"requester_reason:{request_id}")],
        [InlineKeyboardButton("내 요청 다시보기", callback_data=f"requester_view:{request_id}")],
    ])


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.message:
        return

    if is_caregiver(update.message.chat_id):
        await update.message.reply_text(
            "양육자 모드입니다.\n\n"
            "비양육자가 /request 로 요청하면 여기로 전달됩니다.\n"
            "수락은 장소와 시간을 글로 입력하면 됩니다.\n"
            "거절·취소·무응답·미이행은 사유를 함께 기록합니다.\n"
            "완료/미이행에는 실행 메모도 남길 수 있습니다.\n\n"
            "양육자 명령어\n"
            "/menu\n"
            "/list\n"
            "/yearly YYYY\n"
            "/export_yearly YYYY\n"
            "/help",
            reply_markup=build_caregiver_home_keyboard(),
        )
    else:
        await update.message.reply_text(
            "면접교섭 요청 봇입니다.\n\n"
            "비양육자 사용 가능 명령\n"
            "/start\n"
            "/help\n"
            "/request\n"
            "/my_requests\n"
            "/reason 요청ID 사유\n\n"
            "이제 /request 만 입력하면 순서대로 물어봅니다.",
            reply_markup=build_requester_home_keyboard(),
        )


async def help_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await start(update, context)


async def requester_request_start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.message:
        return

    chat_id = update.message.chat_id
    if is_caregiver(chat_id):
        await update.message.reply_text("양육자 계정에서는 /request 를 사용하지 않습니다.")
        return

    PENDING_INPUTS[chat_id] = {"mode": "request_date_time", "form": {}}
    await update.message.reply_text(
        "요청 일시를 입력하세요.\n예: 2026-04-20 14:00 또는 2026.04.20 14시",
        reply_markup=ReplyKeyboardRemove(),
    )


async def handle_home_buttons(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.message:
        return

    chat_id = update.message.chat_id
    text = (update.message.text or "").strip()

    if is_caregiver(chat_id):
        if text == "양육자 메뉴":
            await menu_command(update, context)
            return
        if text == "최근 요청 보기":
            await list_command(update, context)
            return
        if text == "연별 요약":
            PENDING_INPUTS[chat_id] = {"mode": "year_summary"}
            await update.message.reply_text("연도를 입력하세요. 예: 2026")
            return
        if text == "연별 CSV":
            PENDING_INPUTS[chat_id] = {"mode": "year_export"}
            await update.message.reply_text("연도를 입력하세요. 예: 2026")
            return
    else:
        if text == "요청하기":
            await requester_request_start(update, context)
            return
        if text == "내 요청 보기":
            await my_requests_command(update, context)
            return
        if text == "사유 남기기":
            await update.message.reply_text("형식: /reason 요청ID 사유")
            return


async def request_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.message:
        return

    chat_id = update.message.chat_id
    if is_caregiver(chat_id):
        await update.message.reply_text("양육자 계정에서는 /request 를 사용하지 않습니다.")
        return

    text = (update.message.text or "").strip()
    if text == "/request":
        await requester_request_start(update, context)
        return

    try:
        requested_date, requested_time, requested_place, request_message = parse_request_args(update.message.text)
        requester_name = update.effective_user.full_name if update.effective_user else f"chat:{chat_id}"
        request_id = create_request(chat_id, requester_name, requested_date, requested_time, requested_place, request_message)
        row = get_request(request_id)

        await update.message.reply_text(
            "요청이 접수되었습니다.\n\n" + format_request(row),
            reply_markup=build_requester_actions(request_id),
        )

        await context.bot.send_message(
            chat_id=get_caregiver_chat_id(),
            text="비양육자의 면접교섭 요청이 도착했습니다.\n\n" + format_request(row),
            reply_markup=build_caregiver_actions(request_id),
        )
    except Exception as e:
        await update.message.reply_text(f"오류: {e}")


async def my_requests_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.message:
        return

    chat_id = update.message.chat_id
    if is_caregiver(chat_id):
        await update.message.reply_text("양육자는 /list 를 사용하세요.")
        return

    rows = get_requests_for_requester(chat_id, 10)
    if not rows:
        await update.message.reply_text("내 요청 기록이 없습니다.")
        return

    for row in rows:
        await update.message.reply_text(
            format_request(row),
            reply_markup=build_requester_actions(int(row["id"])),
        )


async def reason_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.message:
        return

    chat_id = update.message.chat_id
    if is_caregiver(chat_id):
        await update.message.reply_text("양육자는 버튼을 통해 사유를 입력하세요.")
        return

    parts = update.message.text.strip().split(maxsplit=2)
    if len(parts) < 3:
        await update.message.reply_text("형식: /reason 요청ID 사유")
        return

    try:
        request_id = int(parts[1])
        reason = parts[2]
        row = get_request(request_id)
        if not row:
            await update.message.reply_text("해당 요청을 찾을 수 없습니다.")
            return
        if int(row["requester_chat_id"]) != chat_id:
            await update.message.reply_text("본인 요청에만 사유를 남길 수 있습니다.")
            return

        set_requester_reason(request_id, reason)
        row = get_request(request_id)

        await update.message.reply_text(
            "비양육자 사유가 저장되었습니다.\n\n" + format_request(row),
            reply_markup=build_requester_actions(request_id),
        )
        await context.bot.send_message(
            chat_id=get_caregiver_chat_id(),
            text="비양육자 사유가 추가되었습니다.\n\n" + format_request(row),
            reply_markup=build_caregiver_actions(request_id),
        )
    except Exception as e:
        await update.message.reply_text(f"오류: {e}")


async def menu_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.message and is_caregiver(update.message.chat_id):
        await update.message.reply_text("양육자 메뉴를 선택하세요.", reply_markup=build_caregiver_menu())


async def list_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.message or not is_caregiver(update.message.chat_id):
        return

    rows = get_recent_requests(10)
    if not rows:
        await update.message.reply_text("기록이 없습니다.")
        return

    for row in rows:
        await update.message.reply_text(
            format_request(row),
            reply_markup=build_caregiver_actions(int(row["id"])),
        )


async def yearly_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.message or not is_caregiver(update.message.chat_id):
        return

    parts = update.message.text.strip().split(maxsplit=1)
    if len(parts) != 2:
        await update.message.reply_text("형식: /yearly YYYY")
        return

    try:
        year = parse_year(parts[1])
        await update.message.reply_text(build_year_summary_text(year), parse_mode=ParseMode.MARKDOWN)
    except Exception as e:
        await update.message.reply_text(f"오류: {e}")


async def export_yearly_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.message or not is_caregiver(update.message.chat_id):
        return

    parts = update.message.text.strip().split(maxsplit=1)
    if len(parts) != 2:
        await update.message.reply_text("형식: /export_yearly YYYY")
        return

    try:
        year = parse_year(parts[1])
        rows = get_year_requests(year)
        if not rows:
            await update.message.reply_text("해당 연도 기록이 없습니다.")
            return
        path = export_year_csv(year)
        with path.open("rb") as f:
            await update.message.reply_document(document=f, filename=path.name)
    except Exception as e:
        await update.message.reply_text(f"오류: {e}")


def build_year_summary_text(year: str) -> str:
    rows = get_year_requests(year)
    if not rows:
        return "해당 연도 기록이 없습니다."

    counts = {k: 0 for k in REQUEST_STATUSES}
    for r in rows:
        counts[r["status"]] = counts.get(r["status"], 0) + 1

    lines = [
        f"*{year} 면접교섭 연별 리포트*",
        f"- 총 요청: {len(rows)}",
        f"- 요청: {counts['요청']}",
        f"- 수락: {counts['수락']}",
        f"- 거절: {counts['거절']}",
        f"- 취소: {counts['취소']}",
        f"- 무응답: {counts['무응답']}",
        f"- 완료: {counts['완료']}",
        f"- 미이행: {counts['미이행']}",
        "",
        "*상세 이력*",
    ]

    for r in rows:
        lines.append(f"- ID {r['id']} | {r['requested_date']} {r['requested_time']} | {r['status']}")
        lines.append(f"  비양육자: {r['requester_name']}")
        lines.append(f"  요청장소: {r['requested_place']}")
        lines.append(f"  요청메시지: {r['request_message'] or '-'}")
        lines.append(f"  확정장소/시간: {(r['approved_place'] or '-')} / {(r['approved_time'] or '-')}")
        lines.append(f"  양육자 사유: {r['caregiver_reason'] or '-'}")
        lines.append(f"  비양육자 사유: {r['requester_reason'] or '-'}")
        lines.append(f"  실행메모: {r['execution_note'] or '-'}")

    return "\n".join(lines)


async def on_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.callback_query
    if not query or not query.message:
        return

    await query.answer()
    chat_id = query.message.chat_id
    data = query.data or ""

    try:
        if data == "requester_menu:my_requests":
            if is_caregiver(chat_id):
                await query.message.reply_text("양육자는 /list 를 사용하세요.")
                return
            rows = get_requests_for_requester(chat_id, 10)
            if not rows:
                await query.message.reply_text("내 요청 기록이 없습니다.")
                return
            for row in rows:
                await query.message.reply_text(
                    format_request(row),
                    reply_markup=build_requester_actions(int(row["id"])),
                )
            return

        if data.startswith("requester_view:"):
            request_id = int(data.split(":", 1)[1])
            row = get_request(request_id)
            if not row:
                await query.message.reply_text("기록이 없습니다.")
                return
            if is_caregiver(chat_id) or int(row["requester_chat_id"]) == chat_id:
                await query.message.reply_text(
                    format_request(row),
                    reply_markup=build_requester_actions(request_id) if not is_caregiver(chat_id) else build_caregiver_actions(request_id),
                )
            return

        if data.startswith("requester_reason:"):
            request_id = int(data.split(":", 1)[1])
            row = get_request(request_id)
            if not row:
                await query.message.reply_text("기록이 없습니다.")
                return
            if int(row["requester_chat_id"]) != chat_id:
                await query.message.reply_text("본인 요청에만 사유를 남길 수 있습니다.")
                return
            PENDING_INPUTS[chat_id] = {"mode": "requester_reason", "request_id": request_id}
            await query.message.reply_text("비양육자 사유를 보내주세요.")
            return

        if not is_caregiver(chat_id):
            await query.message.reply_text("양육자만 이 버튼을 사용할 수 있습니다.")
            return

        if data == "menu:recent":
            rows = get_recent_requests(10)
            if not rows:
                await query.message.reply_text("기록이 없습니다.")
                return
            for row in rows:
                await query.message.reply_text(
                    format_request(row),
                    reply_markup=build_caregiver_actions(int(row["id"])),
                )
            return

        if data == "menu:year_summary":
            PENDING_INPUTS[chat_id] = {"mode": "year_summary"}
            await query.message.reply_text("요약할 연도를 보내주세요. 예: 2026")
            return

        if data == "menu:year_export":
            PENDING_INPUTS[chat_id] = {"mode": "year_export"}
            await query.message.reply_text("내보낼 연도를 보내주세요. 예: 2026")
            return

        if data.startswith("view:"):
            request_id = int(data.split(":", 1)[1])
            row = get_request(request_id)
            if row:
                await query.message.reply_text(
                    format_request(row),
                    reply_markup=build_caregiver_actions(request_id),
                )
            return

        if data.startswith("approve:"):
            request_id = int(data.split(":", 1)[1])
            PENDING_INPUTS[chat_id] = {"mode": "approve", "request_id": request_id}
            await query.message.reply_text(
                "수락 정보를 보내주세요. 예: 경주역 2번 출구 14:00 또는 경주역 2번 출구 | 14:00"
            )
            return

        if data.startswith("reason_status:"):
            _, request_id_str, status = data.split(":", 2)
            request_id = int(request_id_str)
            PENDING_INPUTS[chat_id] = {"mode": "caregiver_reason", "request_id": request_id, "status": status}
            await query.message.reply_text(f"양육자 사유를 보내주세요. 상태: {status}")
            return

        if data.startswith("execution:"):
            _, request_id_str, status = data.split(":", 2)
            request_id = int(request_id_str)
            PENDING_INPUTS[chat_id] = {"mode": "execution_note", "request_id": request_id, "status": status}
            await query.message.reply_text(f"실행 메모를 보내주세요. 상태: {status}")
            return

    except Exception as e:
        await query.message.reply_text(f"오류: {e}")


async def on_text_input(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.message:
        return

    chat_id = update.message.chat_id
    pending = PENDING_INPUTS.get(chat_id)
    if not pending:
        await handle_home_buttons(update, context)
        return

    text = update.message.text.strip()

    try:
        mode = pending["mode"]

        if mode == "request_date_time":
            requested_date, requested_time = parse_datetime_flexible(text)
            pending["form"]["requested_date"] = requested_date
            pending["form"]["requested_time"] = requested_time
            pending["mode"] = "request_place"
            await update.message.reply_text("장소를 입력하세요. 예: 경주역 2번 출구")
            return

        if mode == "request_place":
            pending["form"]["requested_place"] = text
            pending["mode"] = "request_message"
            await update.message.reply_text("요청 메시지를 입력하세요. 없으면 '없음'이라고 입력하세요.")
            return

        if mode == "request_message":
            requester_name = update.effective_user.full_name if update.effective_user else f"chat:{chat_id}"
            request_id = create_request(
                chat_id,
                requester_name,
                pending["form"]["requested_date"],
                pending["form"]["requested_time"],
                pending["form"]["requested_place"],
                "" if text == "없음" else text,
            )
            row = get_request(request_id)

            await update.message.reply_text(
                "요청이 접수되었습니다.\n\n" + format_request(row),
                reply_markup=build_requester_actions(request_id),
            )
            await context.bot.send_message(
                chat_id=get_caregiver_chat_id(),
                text="비양육자의 면접교섭 요청이 도착했습니다.\n\n" + format_request(row),
                reply_markup=build_caregiver_actions(request_id),
            )
            await update.message.reply_text("아래 버튼으로 계속 이용할 수 있습니다.", reply_markup=build_requester_home_keyboard())
            PENDING_INPUTS.pop(chat_id, None)
            return

        if mode == "approve":
            request_id = int(pending["request_id"])
            approved_place, approved_time = parse_approval_input(text)
            set_approval(request_id, approved_place, approved_time)
            row = get_request(request_id)

            await context.bot.send_message(
                chat_id=int(row["requester_chat_id"]),
                text=(
                    "면접교섭 요청이 수락되었습니다.\n\n"
                    f"확정장소: {approved_place}\n"
                    f"확정시간: {approved_time}\n"
                    f"요청 ID: {request_id}"
                ),
                reply_markup=build_requester_actions(request_id),
            )
            await update.message.reply_text(
                "수락 및 전달 완료\n\n" + format_request(row),
                reply_markup=build_caregiver_actions(request_id),
            )
            await update.message.reply_text("아래 버튼으로 계속 이용할 수 있습니다.", reply_markup=build_caregiver_home_keyboard())
            PENDING_INPUTS.pop(chat_id, None)
            return

        if mode == "caregiver_reason":
            request_id = int(pending["request_id"])
            status = pending["status"]
            set_status(request_id, status)
            set_caregiver_reason(request_id, text)
            row = get_request(request_id)

            await context.bot.send_message(
                chat_id=int(row["requester_chat_id"]),
                text=(
                    "면접교섭 요청 상태가 변경되었습니다.\n\n"
                    f"상태: {status}\n"
                    f"양육자 사유: {text}\n"
                    f"요청 ID: {request_id}"
                ),
                reply_markup=build_requester_actions(request_id),
            )
            await update.message.reply_text(
                "상태 및 양육자 사유 저장 완료\n\n" + format_request(row),
                reply_markup=build_caregiver_actions(request_id),
            )
            await update.message.reply_text("아래 버튼으로 계속 이용할 수 있습니다.", reply_markup=build_caregiver_home_keyboard())
            PENDING_INPUTS.pop(chat_id, None)
            return

        if mode == "execution_note":
            request_id = int(pending["request_id"])
            status = pending["status"]
            set_status(request_id, status)
            set_execution_note(request_id, text)
            row = get_request(request_id)

            await context.bot.send_message(
                chat_id=int(row["requester_chat_id"]),
                text=(
                    "면접교섭 기록이 업데이트되었습니다.\n\n"
                    f"상태: {status}\n"
                    f"실행메모: {text}\n"
                    f"요청 ID: {request_id}"
                ),
                reply_markup=build_requester_actions(request_id),
            )
            await update.message.reply_text(
                "상태 및 실행 메모 저장 완료\n\n" + format_request(row),
                reply_markup=build_caregiver_actions(request_id),
            )
            await update.message.reply_text("아래 버튼으로 계속 이용할 수 있습니다.", reply_markup=build_caregiver_home_keyboard())
            PENDING_INPUTS.pop(chat_id, None)
            return

        if mode == "requester_reason":
            request_id = int(pending["request_id"])
            row = get_request(request_id)
            if not row or int(row["requester_chat_id"]) != chat_id:
                await update.message.reply_text("본인 요청에만 사유를 남길 수 있습니다.")
            else:
                set_requester_reason(request_id, text)
                row = get_request(request_id)
                await update.message.reply_text(
                    "비양육자 사유 저장 완료\n\n" + format_request(row),
                    reply_markup=build_requester_actions(request_id),
                )
                await context.bot.send_message(
                    chat_id=get_caregiver_chat_id(),
                    text="비양육자 사유가 추가되었습니다.\n\n" + format_request(row),
                    reply_markup=build_caregiver_actions(request_id),
                )
                await update.message.reply_text("아래 버튼으로 계속 이용할 수 있습니다.", reply_markup=build_requester_home_keyboard())
            PENDING_INPUTS.pop(chat_id, None)
            return

        if mode == "year_summary":
            year = parse_year(text)
            await update.message.reply_text(build_year_summary_text(year), parse_mode=ParseMode.MARKDOWN)
            await update.message.reply_text("아래 버튼으로 계속 이용할 수 있습니다.", reply_markup=build_caregiver_home_keyboard())
            PENDING_INPUTS.pop(chat_id, None)
            return

        if mode == "year_export":
            year = parse_year(text)
            rows = get_year_requests(year)
            if not rows:
                await update.message.reply_text("해당 연도 기록이 없습니다.")
            else:
                path = export_year_csv(year)
                with path.open("rb") as f:
                    await update.message.reply_document(document=f, filename=path.name)
            await update.message.reply_text("아래 버튼으로 계속 이용할 수 있습니다.", reply_markup=build_caregiver_home_keyboard())
            PENDING_INPUTS.pop(chat_id, None)
            return

    except Exception as e:
        await update.message.reply_text(f"오류: {e}")


async def reject_unknown_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.message:
        return

    chat_id = update.message.chat_id
    text = update.message.text or ""
    if is_allowed_command(chat_id, text):
        return

    if is_caregiver(chat_id):
        await update.message.reply_text("양육자 명령만 사용할 수 있습니다. /help 를 입력해 확인하세요.")
    else:
        await update.message.reply_text(
            "비양육자 사용 가능 명령은 /request, /my_requests, /reason 입니다.\n"
            "예: /request 2026-04-20 14:00 경주역 점심 후 카페 희망"
        )


def main() -> None:
    token = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
    if not token:
        raise RuntimeError("환경변수 TELEGRAM_BOT_TOKEN 이 필요합니다.")

    get_caregiver_chat_id()

    try:
        asyncio.get_event_loop()
    except RuntimeError:
        asyncio.set_event_loop(asyncio.new_event_loop())

    app = Application.builder().token(token).build()
    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("help", help_command))
    app.add_handler(CommandHandler("request", request_command))
    app.add_handler(CommandHandler("my_requests", my_requests_command))
    app.add_handler(CommandHandler("reason", reason_command))
    app.add_handler(CommandHandler("menu", menu_command))
    app.add_handler(CommandHandler("list", list_command))
    app.add_handler(CommandHandler("yearly", yearly_command))
    app.add_handler(CommandHandler("export_yearly", export_yearly_command))
    app.add_handler(CallbackQueryHandler(on_callback))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, on_text_input))
    app.add_handler(MessageHandler(filters.COMMAND, reject_unknown_command))

    logger.info("Bot started")
    app.run_polling(close_loop=False)


if __name__ == "__main__":
    main()
#!/usr/bin/env python3
"""產生 Guided Notes 結構測試用 xlsx fixtures。

只產生 03–05 與 90–92；01/02 是 TA 官方範例，應以 cp 複製。
本腳本不依賴版面上的固定座標來驗證，只負責建立各種固定結構變化。
"""

from datetime import datetime
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, Side
from openpyxl.utils import get_column_letter

ROOT = Path(__file__).resolve().parent.parent

TITLE_FONT = Font(name="Arial", size=16, bold=True)
HEADER_FONT = Font(name="Arial", size=11, bold=True)
BODY_FONT = Font(name="Arial", size=11)

MEDIUM = Side(style="medium")
THIN = Side(style="thin")
OUTER_BORDER = Border(left=MEDIUM, right=MEDIUM, top=MEDIUM, bottom=MEDIUM)
CELL_BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
NO_BORDER = Border()

CENTER = Alignment(horizontal="center", vertical="center")
TEXT_LEFT = Alignment(horizontal="left", vertical="center", wrap_text=True)


def style_range(ws, min_row, min_col, max_row, max_col, font, border, alignment):
    for row in ws.iter_rows(
        min_row=min_row,
        min_col=min_col,
        max_row=max_row,
        max_col=max_col,
    ):
        for cell in row:
            cell.font = font
            cell.border = border
            cell.alignment = alignment


def merge_box(ws, min_row, min_col, max_row, max_col, value, font, border, alignment):
    style_range(ws, min_row, min_col, max_row, max_col, font, border, alignment)
    if min_row != max_row or min_col != max_col:
        ws.merge_cells(
            start_row=min_row,
            start_column=min_col,
            end_row=max_row,
            end_column=max_col,
        )
    ws.cell(min_row, min_col).value = value


def prepare_workbook():
    workbook = Workbook()
    # 固定 metadata，讓重跑不因建立時間造成非內容性差異。
    fixed_time = datetime(2026, 1, 1)
    workbook.properties.created = fixed_time
    workbook.properties.modified = fixed_time
    return workbook


def set_widths(ws, widths):
    for column, width in widths.items():
        ws.column_dimensions[get_column_letter(column)].width = width


def add_title(ws, row, min_col, max_col, title):
    ws.row_dimensions[row].height = 46
    merge_box(ws, row, min_col, row, max_col, title, TITLE_FONT, OUTER_BORDER, CENTER)


def add_header(ws, row, number_col, question_start, question_end, answer_start, answer_end):
    ws.row_dimensions[row].height = 30
    merge_box(ws, row, number_col, row, number_col, "題號", HEADER_FONT, OUTER_BORDER, CENTER)
    merge_box(ws, row, question_start, row, question_end, "題目", HEADER_FONT, OUTER_BORDER, CENTER)
    merge_box(ws, row, answer_start, row, answer_end, "作答", HEADER_FONT, OUTER_BORDER, CENTER)


def add_spacer(ws, row, min_col, max_col, height=13.5):
    ws.row_dimensions[row].height = height
    merge_box(ws, row, min_col, row, max_col, None, BODY_FONT, CELL_BORDER, TEXT_LEFT)


def add_single(
    ws,
    row,
    number_col,
    question_start,
    question_end,
    answer_start,
    answer_end,
    number,
    text,
    extra_col=None,
    category=None,
    height=78,
):
    ws.row_dimensions[row].height = height
    if extra_col is not None:
        merge_box(ws, row, extra_col, row, extra_col, category, BODY_FONT, CELL_BORDER, CENTER)
    merge_box(ws, row, number_col, row, number_col, number, BODY_FONT, CELL_BORDER, CENTER)
    merge_box(ws, row, question_start, row, question_end, text, BODY_FONT, CELL_BORDER, TEXT_LEFT)
    merge_box(ws, row, answer_start, row, answer_end, None, BODY_FONT, CELL_BORDER, CENTER)


def add_group(
    ws,
    start_row,
    number_col,
    question_start,
    question_end,
    answer_start,
    answer_end,
    number,
    subquestions,
    extra_col=None,
    category=None,
    height=54,
):
    end_row = start_row + len(subquestions) - 1
    for index, (text, prefix) in enumerate(subquestions):
        row = start_row + index
        ws.row_dimensions[row].height = height
        if extra_col is not None:
            merge_box(
                ws,
                row,
                extra_col,
                row,
                extra_col,
                category if index == 0 else None,
                BODY_FONT,
                CELL_BORDER,
                CENTER,
            )
        merge_box(ws, row, number_col, row, number_col, None, BODY_FONT, CELL_BORDER, CENTER)
        merge_box(ws, row, question_start, row, question_end, text, BODY_FONT, CELL_BORDER, TEXT_LEFT)
        merge_box(ws, row, answer_start, row, answer_end, prefix, BODY_FONT, CELL_BORDER, CENTER)

    if end_row > start_row:
        ws.merge_cells(
            start_row=start_row,
            start_column=number_col,
            end_row=end_row,
            end_column=number_col,
        )
    ws.cell(start_row, number_col).value = number
    ws.cell(start_row, number_col).alignment = CENTER


def make_shifted_layout():
    workbook = prepare_workbook()
    ws = workbook.active
    ws.title = "學習單"
    set_widths(ws, {1: 3, 2: 10, 3: 7, 4: 14, 5: 14, 6: 14, 7: 14, 8: 14, 9: 12, 10: 24})
    add_title(ws, 3, 3, 10, "資料結構與系統觀念 學習單")

    ws.row_dimensions[4].height = 24
    merge_box(ws, 4, 2, 4, 2, "說明", HEADER_FONT, OUTER_BORDER, CENTER)
    merge_box(ws, 4, 3, 4, 10, "請依序以簡短詞句作答；題組會在作答欄標示小題。", BODY_FONT, OUTER_BORDER, TEXT_LEFT)
    ws.row_dimensions[5].height = 18
    merge_box(ws, 5, 2, 5, 10, "注意：欄位位置與標題列位置已刻意調整，解析時須依表頭與合併範圍定位。", BODY_FONT, NO_BORDER, TEXT_LEFT)

    ws.row_dimensions[6].height = 30
    merge_box(ws, 6, 2, 6, 2, "類別", HEADER_FONT, OUTER_BORDER, CENTER)
    add_header(ws, 6, 3, 4, 8, 9, 10)

    questions = [
        "哪一種記憶體在電腦斷電後內容會消失，常用來暫存正在執行的程式與資料？",
        "作業系統中負責決定下一個要使用中央處理器的執行緒或程序的機制，通常稱為什麼排程？",
        "HTTP 傳輸時將位元組送連串到遠端伺服器，目前 Web 加密傳輸主要依賴哪個通訊安全協定？",
        "關聯式資料庫中，能唯一辨識每一筆資料列且不重複的欄位集合稱為什麼？",
        "軟體設計中把相關資料與操作封裝在一起，並隱藏內部實作細節的原則是什麼？",
        "版本控制系統裡，用來標記一個提交節點轉移到另一條開發線的動作稱為什麼？",
        "在程式語言中，函式對同一字元串或物件使用不同名稱的現象，在觀念上與哪一種別名問題有關？",
        "當服務收到大量請求時，將請求分散到多台伺服器以提升可用性的設計方法稱為什麼？",
    ]

    row = 7
    spacers = [2, 1, 3, 2, 1, 2, 1]
    for index, text in enumerate(questions, start=1):
        add_single(ws, row, 3, 4, 8, 9, 10, index, text, extra_col=2, category="簡答", height=72)
        if index < len(questions):
            for _ in range(spacers[index - 1]):
                row += 1
                add_spacer(ws, row, 2, 10, height=12)
            row += 1

    workbook.save(ROOT / "03-shifted-layout.xlsx")
    workbook.close()


def make_mixed_groups():
    workbook = prepare_workbook()
    ws = workbook.active
    ws.title = "學習單"
    set_widths(ws, {1: 3, 2: 7, 3: 15, 4: 15, 5: 15, 6: 15, 7: 10, 8: 16, 9: 16})
    add_title(ws, 2, 2, 9, "計算機科學綜合題組 學習單")
    ws.row_dimensions[3].height = 18
    add_header(ws, 4, 2, 3, 6, 7, 9)

    add_single(ws, 5, 2, 3, 6, 7, 9, 1, "將原始碼逐行解譯並直接執行，而不是先完整編譯成機器碼的軟體稱為什麼？", height=66)
    add_spacer(ws, 6, 2, 9)
    add_group(
        ws,
        7,
        2,
        3,
        6,
        7,
        9,
        2,
        [
            ("小明想把訊息分成固定大小的封包再透過網路傳送，這種交換技術稱為什麼？", "（1）"),
            ("他想讓不同網段彼此連線時使用憑藉 IP 判斷路徑的設備，那台設備是什麼？", "（2）"),
            ("若只想在區域網路內以 MAC 位址轉送資料，他應使用哪一種設備？", "（3）"),
        ],
        height=58,
    )
    add_spacer(ws, 10, 2, 9)
    add_single(ws, 11, 2, 3, 6, 7, 9, 3, "在測試程式時，用最小可執行單位驗證函式或方法行為的測試類型是什麼？", height=64)
    add_spacer(ws, 12, 2, 9)
    add_spacer(ws, 13, 2, 9)
    add_group(
        ws,
        14,
        2,
        3,
        6,
        7,
        9,
        4,
        [
            ("小華讀取檔案時，以先進先出的方式處理請求，這種資料結構是什麼？", "（1）"),
            ("接著她使用平均可查 O(1) 的結構儲存使用者的設定資料，這種結構是什麼表？", "（2）"),
        ],
        height=58,
    )
    add_spacer(ws, 16, 2, 9)
    add_single(ws, 17, 2, 3, 6, 7, 9, 5, "物件導向設計中，子類別取得父類別屬性與方法以重複使用功能的機制稱為什麼？", height=64)
    add_spacer(ws, 18, 2, 9)
    add_group(
        ws,
        19,
        2,
        3,
        6,
        7,
        9,
        6,
        [
            ("部署團隊每次整合程式後自動建置與測試，這個實務的英文縮寫通常是什麼？", "（1）"),
            ("接著他們把已驗證的更新持續送到正式環境，這個後續部署流程又稱為什麼？", "（2）"),
        ],
        height=58,
    )
    add_spacer(ws, 21, 2, 9)
    add_single(ws, 22, 2, 3, 6, 7, 9, 7, "在瀏覽器中，用來存放少量鍵值資料且關閉分頁後通常仍保留的客戶端儲存 API 是什麼？", height=64)

    workbook.save(ROOT / "04-mixed-groups.xlsx")
    workbook.close()


def make_two_sheets():
    workbook = prepare_workbook()
    info = workbook.active
    info.title = "說明"
    info.column_dimensions["A"].width = 90
    info.sheet_format.defaultColWidth = 15
    info["A1"] = "本活頁簿用來測試 Guided Notes 不在第一張工作表的情況。"
    info["A2"] = "請解析器掃描所有工作表，並在『學習單』中找到題號、題目、作答表頭。"
    info["A3"] = "正式題目全部位於第二張工作表。"
    for row in range(1, 4):
        info.cell(row, 1).font = BODY_FONT
        info.cell(row, 1).alignment = TEXT_LEFT

    ws = workbook.create_sheet("學習單")
    set_widths(ws, {1: 3, 2: 7, 3: 17, 4: 17, 5: 17, 6: 17, 7: 8, 8: 24})
    add_title(ws, 2, 2, 8, "網路與資料管理 學習單")
    ws.row_dimensions[3].height = 18
    add_header(ws, 4, 2, 3, 6, 7, 8)

    questions = [
        "在 TCP/IP 模型的傳輸層中，標示應用程式通訊端點所使用的號碼稱為什麼埠？",
        "把程式模組彼此互不依賴的程度稱為耦合；那我們通常希望同一模組內部功能相關性如何？",
        "在關聯式資料庫中，查詢資料時連接兩張資料表最常使用的 SQL 子句關鍵字是什麼？",
        "軟體重構的目的是在不改變外部行為下改善哪一項內部品質？",
        "敏捷開發中，用來描述可交付的一段使用需求且常以使用者角度撰寫的規格稱為什麼？",
    ]
    row = 5
    for index, text in enumerate(questions, start=1):
        add_single(ws, row, 2, 3, 6, 7, 8, index, text, height=66)
        if index < len(questions):
            add_spacer(ws, row + 1, 2, 8)
            row += 2

    workbook.active = workbook.sheetnames.index("學習單")
    workbook.save(ROOT / "05-two-sheets.xlsx")
    workbook.close()


def make_invalid_no_header():
    workbook = prepare_workbook()
    ws = workbook.active
    ws.title = "學習單"
    set_widths(ws, {1: 3, 2: 7, 3: 17, 4: 17, 5: 17, 6: 17, 7: 8, 8: 24})
    add_title(ws, 2, 2, 8, "表頭驗證失敗範例")
    ws.row_dimensions[4].height = 30
    merge_box(ws, 4, 2, 4, 2, "序號", HEADER_FONT, OUTER_BORDER, CENTER)
    merge_box(ws, 4, 3, 4, 6, "問題", HEADER_FONT, OUTER_BORDER, CENTER)
    merge_box(ws, 4, 7, 4, 8, "答案", HEADER_FONT, OUTER_BORDER, CENTER)
    add_single(ws, 5, 2, 3, 6, 7, 8, 1, "這份表格刻意使用非官方欄位名稱，因此不應視為 Guided Notes。", height=62)
    add_spacer(ws, 6, 2, 8)
    add_single(ws, 7, 2, 3, 6, 7, 8, 2, "缺少題號、題目與作答三者中的至少一個，即應拒絕匯入。", height=62)
    workbook.save(ROOT / "90-invalid-no-header.xlsx")
    workbook.close()


def make_invalid_duplicate_number():
    workbook = prepare_workbook()
    ws = workbook.active
    ws.title = "學習單"
    set_widths(ws, {1: 3, 2: 7, 3: 17, 4: 17, 5: 17, 6: 17, 7: 8, 8: 24})
    add_title(ws, 2, 2, 8, "重複題號驗證範例")
    ws.row_dimensions[3].height = 18
    add_header(ws, 4, 2, 3, 6, 7, 8)
    rows = [5, 7, 9, 11]
    numbers = [1, 2, 3, 3]
    texts = [
        "第一題：以二進位表示十進位數字 2 的值是什麼？",
        "第二題：讓作業系統保護檔案存取的安全機制稱為什麼？",
        "第三題：用來將領域名稱轉換成 IP 位址的網路服務是什麼？",
        "另一個重複的第三題：此編號重複，匯入程式應回報錯誤。",
    ]
    for number, text, row in zip(numbers, texts, rows):
        add_single(ws, row, 2, 3, 6, 7, 8, number, text, height=62)
        if row < 11:
            add_spacer(ws, row + 1, 2, 8)
    workbook.save(ROOT / "91-invalid-duplicate-number.xlsx")
    workbook.close()


def make_invalid_empty():
    workbook = prepare_workbook()
    ws = workbook.active
    ws.title = "學習單"
    set_widths(ws, {1: 3, 2: 7, 3: 17, 4: 17, 5: 17, 6: 17, 7: 8, 8: 24})
    add_title(ws, 2, 2, 8, "空白題目驗證範例")
    ws.row_dimensions[3].height = 18
    add_header(ws, 4, 2, 3, 6, 7, 8)
    add_spacer(ws, 5, 2, 8)
    workbook.save(ROOT / "92-invalid-empty.xlsx")
    workbook.close()


def main():
    make_shifted_layout()
    make_mixed_groups()
    make_two_sheets()
    make_invalid_no_header()
    make_invalid_duplicate_number()
    make_invalid_empty()
    print("generated 03, 04, 05, 90, 91, 92 fixtures")


if __name__ == "__main__":
    main()

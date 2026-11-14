import xlrd

wb = xlrd.open_workbook(r'C:/Users/kaire/.gemini/antigravity/scratch/electro/public/data/P5354-DATASHEET.xls', formatting_info=True)
print('Sheets:', wb.sheet_names())
for sname in wb.sheet_names():
    ws = wb.sheet_by_name(sname)
    print(f'\n=== {sname} ({ws.nrows}r x {ws.ncols}c) ===')
    for r in range(min(ws.nrows, 120)):
        for c in range(min(ws.ncols, 25)):
            v = ws.cell_value(r,c)
            if v not in ('', 0, 0.0):
                print(f'  ({r},{c}) = {repr(v)}')
    # merged cells
    print('Merges:', ws.merged_cells[:20])

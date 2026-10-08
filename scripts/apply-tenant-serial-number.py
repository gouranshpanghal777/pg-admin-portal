from pathlib import Path

path = Path('src/App.tsx')
text = path.read_text()

active_header_old = "<DataTable headers={['Tenant name', 'Email/phone', 'Room', 'Room type', 'Monthly rent', 'Rent paid', 'Rent balance', 'Security', 'Security received', 'Security balance', 'Electricity', 'Since', 'Rent Due Date', 'Status', 'Actions']}>"
active_header_new = "<DataTable headers={['S.No.', 'Tenant name', 'Email/phone', 'Room', 'Room type', 'Monthly rent', 'Rent paid', 'Rent balance', 'Security', 'Security received', 'Security balance', 'Electricity', 'Since', 'Rent Due Date', 'Status', 'Actions']}>"
if active_header_old not in text:
    raise SystemExit('Active tenant table header not found')
text = text.replace(active_header_old, active_header_new, 1)

active_start = text.index(active_header_new)
active_map_old = '{displayList.map((tenant) => {'
active_map_pos = text.find(active_map_old, active_start)
if active_map_pos == -1:
    raise SystemExit('Active tenant map not found')
text = text[:active_map_pos] + '{displayList.map((tenant, index) => {' + text[active_map_pos + len(active_map_old):]

active_row_old = 'return <tr key={tenant.id} className="border-t border-slate-100">\n              <td className="p-3 font-semibold">{tenant.name}</td>'
active_row_new = 'return <tr key={tenant.id} className="border-t border-slate-100">\n              <td className="p-3 text-center font-semibold text-slate-500">{index + 1}</td><td className="p-3 font-semibold">{tenant.name}</td>'
active_row_pos = text.find(active_row_old, active_map_pos)
if active_row_pos == -1:
    raise SystemExit('Active tenant row not found')
text = text[:active_row_pos] + active_row_new + text[active_row_pos + len(active_row_old):]

left_header_old = "<DataTable headers={['Tenant', 'Room', 'Type', 'Joined', 'Left date', 'Reason', 'Security', 'Extra days', 'Extra rent charge', 'Settlement received', 'Balance at exit', 'Contact', 'Actions']}>"
left_header_new = "<DataTable headers={['S.No.', 'Tenant', 'Room', 'Type', 'Joined', 'Left date', 'Reason', 'Security', 'Extra days', 'Extra rent charge', 'Settlement received', 'Balance at exit', 'Contact', 'Actions']}>"
if left_header_old not in text:
    raise SystemExit('Left tenant table header not found')
text = text.replace(left_header_old, left_header_new, 1)

left_start = text.index(left_header_new)
left_map_old = '{displayList.map((tenant) => { const room = data.rooms.find((item) => item.id === tenant.roomId)!; return <tr key={tenant.id} className="border-t border-slate-100"><td className="p-3 font-semibold">{tenant.name}</td>'
left_map_new = '{displayList.map((tenant, index) => { const room = data.rooms.find((item) => item.id === tenant.roomId)!; return <tr key={tenant.id} className="border-t border-slate-100"><td className="p-3 text-center font-semibold text-slate-500">{index + 1}</td><td className="p-3 font-semibold">{tenant.name}</td>'
left_map_pos = text.find(left_map_old, left_start)
if left_map_pos == -1:
    raise SystemExit('Left tenant row/map not found')
text = text[:left_map_pos] + left_map_new + text[left_map_pos + len(left_map_old):]

path.write_text(text)

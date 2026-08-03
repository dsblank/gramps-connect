import sys

import gi

gi.require_version("Gtk", "3.0")

from gramps.gen.db.utils import make_database
from gramps.gen.dbstate import DbState
from gramps.cli.user import User
from gramps.plugins.export.exportxml import export_data

src_path, out_path = sys.argv[1], sys.argv[2]

db = make_database("sqlite")
db.load(src_path)

user = User()
ok = export_data(db, out_path, user)
db.close()
print("export ok:", ok)

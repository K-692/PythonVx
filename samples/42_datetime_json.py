# Title: datetime & json
# Group: Standard library
import datetime
import json

today = datetime.date(2026, 11, 19)
later = today + datetime.timedelta(days=45)
print("45 days later:", later.isoformat(), later.strftime("%A"))

person = {"name": "Linus", "langs": ["C", "Python"], "active": True}
text = json.dumps(person)
back = json.loads(text)
print(text)
print(back["langs"][1])

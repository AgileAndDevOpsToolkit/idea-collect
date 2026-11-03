#!/usr/bin/env python3
"""Test HTTP sur une instance jetable. Bibliothèque standard Python uniquement."""
import argparse
import csv
import io
import json
import os
import re
import secrets
import threading
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("base", help="URL de l’instance de test")
parser.add_argument("--record", type=Path, help="Écrit un témoin de persistance")
parser.add_argument("--verify", type=Path, help="Relit le témoin après redémarrage")
args = parser.parse_args()
base = args.base.rstrip("/") + "/"
app_key = os.getenv("TEST_APP_KEY", "atelier-idees-web-v1")
admin_key = os.getenv("TEST_ADMIN_KEY", "atelier-idees-admin-2027")


def call(action, code=None, body=None, *, admin=False, token=None, expected=200,
         key=app_key, method=None):
    params = {"action": action}
    if code is not None:
        params["code"] = code
    headers = {}
    if key is not None:
        headers["X-App-Key"] = key
    if admin:
        headers["X-Admin-Key"] = admin_key
    if token:
        headers["X-Participant-Token"] = token
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(base + "api.php?" + urllib.parse.urlencode(params),
                                 data=data, headers=headers, method=method)
    try:
        response = urllib.request.urlopen(req, timeout=30)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        raw = response.read()
        assert response.status == expected, (action, response.status, raw[:500])
        if response.headers.get_content_type() == "text/csv":
            assert "attachment" in response.headers["Content-Disposition"]
            assert raw.startswith(b"\xef\xbb\xbf")
            return list(csv.reader(io.StringIO(raw.decode("utf-8-sig"), newline=""), delimiter=";"))
        return json.loads(raw)


def make_session(question):
    return {"question": question, "requestId": secrets.token_hex(16)}


def collection(code):
    return call("ideas", code, admin=True)


def main():
    with urllib.request.urlopen(base + "health.php", timeout=15) as r:
        assert r.read() == b"ok\n"
    if args.verify:
        witness = json.loads(args.verify.read_text())
        assert collection(witness["session"]["code"]) == witness
        print("OK · session, question et toutes les idées relues après redémarrage")
        return

    call("sessions", key=None, expected=401)
    call("sessions", expected=401)
    call("create", body=make_session("Privé"), expected=401)
    call("sessions", admin=True, method="POST", expected=405)
    call("session", "12", expected=422)
    call("create", admin=True, body=make_session("  "), expected=422)
    create = make_session("Qu’est-ce que vous voulez livrer en juin 2027 ?")
    session = call("create", admin=True, body=create, expected=201)["session"]
    code = session["code"]
    assert re.fullmatch("[A-HJ-NP-Z2-9]{6}", code)
    assert call("create", admin=True, body=create, expected=201)["session"] == session
    other = call("create", admin=True, body=make_session("Autre atelier"), expected=201)["session"]["code"]
    assert other != code
    assert call("session", code.lower()) == {"session": session}
    assert call("csv", code, admin=True) == [["Idée"]]
    call("csv", code, expected=401)
    call("ideas", code, expected=401)
    call("join", code, {"nickname": " \t\n"}, expected=422)
    nickname = "PSEUDO-TEMOIN-CONFIDENTIEL"
    token = call("join", code, {"nickname": nickname}, expected=201)["token"]
    first = {"idea": '  Livrer "Été";\r\npuis\t tester 🚀  ', "revision": 1, "requestId": secrets.token_hex(16)}
    call("submit", code, first, expected=403)
    call("submit", other, first, token=token, expected=403)
    call("submit", code, {**first, "idea": " "}, token=token, expected=422)
    call("submit", code, {**first, "idea": "x" * 1001}, token=token, expected=422)
    saved = call("submit", code, first, token=token, expected=201)
    assert call("submit", code, first, token=token) == {"id": saved["id"], "created": False}
    call("submit", code, {**first, "idea": "Autre texte"}, token=token, expected=409)
    assert collection(other)["ideas"] == []
    expected_text = 'Livrer "Été"; puis tester 🚀'
    assert collection(code)["ideas"] == [expected_text]

    edit = {"question": "Quelle livraison préparer en juin ?", "revision": 1}
    call("edit", code, edit, token=token, expected=401)
    assert call("edit", code, edit, admin=True)["session"]["revision"] == 2
    call("edit", code, {**edit, "question": "Édition périmée"}, admin=True, expected=409)
    call("submit", code, {**first, "requestId": secrets.token_hex(16)}, token=token, expected=409)
    assert call("submit", code, first, token=token)["id"] == saved["id"]
    formula = {"idea": "=1+2", "revision": 2, "requestId": secrets.token_hex(16)}
    call("submit", code, formula, token=token, expected=201)

    # Cinquante participants distincts rejoignent l’atelier et envoient chacun une proposition.
    number = 50
    gate = threading.Barrier(number)
    def participant(i):
        gate.wait(timeout=20)
        admission = call("join", code, {"nickname": "Participant " + str(i)}, expected=201)
        idea = {"idea": "Proposition " + str(i), "revision": 2, "requestId": secrets.token_hex(16)}
        call("submit", code, idea, token=admission["token"], expected=201)
    with ThreadPoolExecutor(max_workers=number) as pool:
        list(pool.map(participant, range(number)))

    # Un même envoi est rejoué en parallèle après perte supposée de son accusé de réception.
    retry = json.dumps({"idea": "Réessai simultané", "revision": 2, "requestId": secrets.token_hex(16)}).encode()
    def simultaneous(_):
        req = urllib.request.Request(base + "api.php?action=submit&code=" + code, data=retry,
            headers={"X-App-Key": app_key, "X-Participant-Token": token, "Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.load(r)
    with ThreadPoolExecutor(max_workers=12) as pool:
        repeats = list(pool.map(simultaneous, range(12)))
    assert sum(item["created"] for item in repeats) == 1
    assert len({item["id"] for item in repeats}) == 1

    result = collection(code)
    ideas = result["ideas"]
    assert len(ideas) == number + 3
    assert ideas[:2] == [expected_text, "=1+2"] and ideas[-1] == "Réessai simultané"
    assert set(ideas[2:-1]) == {"Proposition " + str(i) for i in range(number)}
    assert all(len(text.splitlines()) == 1 for text in ideas)
    assert nickname not in json.dumps(result)
    rows = call("csv", code, admin=True)
    assert rows == [["Idée"]] + [["'=1+2" if i == "=1+2" else i] for i in ideas]
    assert collection(other)["ideas"] == []
    listing = call("sessions", admin=True)["sessions"]
    assert next(s["idea_count"] for s in listing if s["code"] == code) == len(ideas)
    if args.record:
        args.record.write_text(json.dumps(result, ensure_ascii=False))
    print("OK · accès, isolation, question modifiable, 50 participants concurrents, "
          "réessais sans doublons, anonymat et CSV")


if __name__ == "__main__":
    main()

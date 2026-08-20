# -*- coding: utf-8 -*-
"""OwnerView 서비스 소개서 v2 — 실행 진입점
   python scripts/deck2_run.py  →  dist/OwnerView_서비스소개서.pptx (34장)"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import deck2_make            # 01~07  (import 시 슬라이드가 만들어진다)
from deck2_core import prs
from deck2_make2 import part2
from deck2_make3 import part3

part2()                      # 08~20
part3()                      # 21~34

os.makedirs("dist", exist_ok=True)
out = "dist/OwnerView_서비스소개서.pptx"
prs.save(out)
n = len(prs.slides._sldIdLst)
print("saved:", out, "| slides:", n)

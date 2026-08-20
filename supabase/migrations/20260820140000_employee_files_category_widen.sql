-- 입사서류 업로드 실패 (2026-08-20 사장님 제보: "PDF 가 업로드 안 된다")
--   실제 원인은 파일 형식이 아니라 서류 종류였다. employee_files.category 체크 제약이
--   초기 6종(resume/id_copy/bank_copy/resident_reg/portfolio/other)에 머물러 있는데,
--   화면(입사서류 체크리스트)은 그 뒤 diploma·career_cert·health_check·nda·privacy_consent
--   5종을 더 쓴다. 그 5줄은 파일 형식과 무관하게 전부 400(check constraint)으로 막혔다.
--   사장님은 통장사본(bank_copy)에 JPG, 개인정보동의서(privacy_consent)에 PDF 를 올려 보고
--   "PDF 만 안 된다"고 보신 것.
--
--   화면 목록과 제약을 일치시킨다. 앞으로 체크리스트에 항목을 더할 때는
--   EmployeeDetailPanel 의 ONBOARDING_DOC_DEFAULTS 와 이 제약을 함께 고쳐야 한다.

ALTER TABLE public.employee_files
  DROP CONSTRAINT IF EXISTS employee_files_category_check;

ALTER TABLE public.employee_files
  ADD CONSTRAINT employee_files_category_check CHECK (
    category = ANY (ARRAY[
      -- 기존
      'resume', 'id_copy', 'bank_copy', 'resident_reg', 'portfolio', 'other',
      -- 입사서류 체크리스트 (화면 ONBOARDING_DOC_DEFAULTS 와 1:1)
      'diploma', 'career_cert', 'health_check', 'nda', 'privacy_consent'
    ])
  );

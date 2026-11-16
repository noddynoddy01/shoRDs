shoRDs local pilot kit (Phase 6A)
=================================
This folder is a self-contained copy of the code needed to run the native-pipeline pilot against a language model on THIS computer.
It does not need, change or touch your D:\shords checkout. It contains no passwords, keys, .env files or paper text.

What is in it
  Probe-Hardware.ps1   read-only hardware check (run this first)
  Verify-Kit.ps1       checks that every file in this kit is complete and unmodified
  scripts\native_pilot.js, backend\...   the pilot driver and the pipeline code it uses (plain Node.js, no packages to install)
  papers.template.json   copy to papers.json and fill in three licence-confirmed papers

What it never does
  It only talks to a model server on 127.0.0.1 (this computer). It refuses any other address. It makes no other network connection.
  Paper text and model output stay in the output folder you choose.

Next: follow the step-by-step instructions in docs\phase6\08_LOCAL_SETUP_WINDOWS.md (also in your shoRDs project) one step at a time,
and do not install or download anything until you have approved the checklist in 09_APPROVAL_CHECKLIST.md.

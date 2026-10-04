Name:           task-list
Version:        %{?pkgversion}%{!?pkgversion:1.0.0}
Release:        %{?pkgrelease}%{!?pkgrelease:1}%{?dist}
Summary:        Keyboard-first task list with projects, deadlines and priorities
License:        LicenseRef-Not-Specified
BuildArch:      noarch
Source0:        %{name}-%{version}.tar.gz

BuildRequires:  desktop-file-utils
BuildRequires:  systemd-rpm-macros
Requires:       nodejs(engine) >= 22.13
Requires:       python3-gobject
Requires:       gtk4
Requires:       libadwaita
Requires:       webkitgtk6.0
Requires:       systemd

%description
A desktop task list. Typing works like a text editor, tasks can be nested and
reprioritized by dragging, projects are colour-coded and can be shown separately
or interleaved, and deadlines turn red as the time left approaches the estimate.
Data is stored in SQLite under ~/.local/share/task-list.

%prep
%autosetup

%build

%install
install -Dm644 index.html  %{buildroot}%{_datadir}/%{name}/index.html
install -Dm644 server.js   %{buildroot}%{_datadir}/%{name}/server.js
install -Dm755 packaging/task-list %{buildroot}%{_bindir}/task-list
install -Dm644 packaging/task-list.service %{buildroot}%{_userunitdir}/task-list.service
install -Dm644 packaging/io.github.tasklist.TaskList.desktop \
  %{buildroot}%{_datadir}/applications/io.github.tasklist.TaskList.desktop
install -Dm644 packaging/io.github.tasklist.TaskList-autostart.desktop \
  %{buildroot}%{_sysconfdir}/xdg/autostart/io.github.tasklist.TaskList.desktop
install -Dm644 packaging/io.github.tasklist.TaskList.svg \
  %{buildroot}%{_datadir}/icons/hicolor/scalable/apps/io.github.tasklist.TaskList.svg

%check
desktop-file-validate %{buildroot}%{_datadir}/applications/io.github.tasklist.TaskList.desktop
desktop-file-validate %{buildroot}%{_sysconfdir}/xdg/autostart/io.github.tasklist.TaskList.desktop

%post
# Start the server at login for every user.
systemctl --global enable task-list.service >/dev/null 2>&1 || :

%preun
if [ $1 -eq 0 ]; then
  systemctl --global disable task-list.service >/dev/null 2>&1 || :
fi

%files
%doc README.md
%{_bindir}/task-list
%{_datadir}/%{name}/
%{_userunitdir}/task-list.service
%{_datadir}/applications/io.github.tasklist.TaskList.desktop
%config(noreplace) %{_sysconfdir}/xdg/autostart/io.github.tasklist.TaskList.desktop
%{_datadir}/icons/hicolor/scalable/apps/io.github.tasklist.TaskList.svg

%changelog
* Sun Oct 04 2026 Task List <noreply@localhost> - 1.0.0-1
- Initial package

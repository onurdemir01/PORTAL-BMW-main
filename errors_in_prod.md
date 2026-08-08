commit ettikten sonra geldim admin kısmını düzenledim 

prod	ark	gbocpankprod2	GBARKAP82	✓	
prod	ark	gbocpprod1	GBARKP51	✓	
prod	ark	gbocpprod2	GBARKP52	✓	
prod	ark	gbocpprod4	GBARKP54	✓

şu şekilde ekledim

logx ocp kısmını çalıştırdım.

portalde bunu verdi:
Job sonlandı ancak yapılandırılmış çıktı bulunamadı (beklenen: artifacts.logx_result veya artifacts.data.logx_result). Mevcut anahtarlar: top=[], data=[], ansible_stats.data=[]. AWX ayrıntısı: jobId=3203029, serverId=2, status=failed, playbook=bmw_automation_folder/portal_tamplates/logx_ocp_namespace_discovery.yml, inventory=BMW - Openshift Jump Server Inventory. Playbook set_stats adımını ve AWX template'in doğru playbook'a bağlı olduğunu kontrol edin.


ansible kısmında ise:

{
  "terminal_host": "GBARKAP82",
  "ocp_clusters": [
    {
      "env": "prod",
      "tenant": "ark",
      "cluster_name": "gbocpankprod2",
      "terminal_host": "GBARKAP82"
    },
    {
      "env": "prod",
      "tenant": "ark",
      "cluster_name": "gbocpprod1",
      "terminal_host": "GBARKP51"
    },
    {
      "env": "prod",
      "tenant": "ark",
      "cluster_name": "gbocpprod4",
      "terminal_host": "GBARKP54"
    }
  ],
  "terminal_hosts": [
    "GBARKAP82",
    "GBARKP51",
    "GBARKP54"
  ]
}

bu variablelarla job çağrıldı

Identity added: /runner/artifacts/3203029/ssh_key_data (uxmid@gbansp01)
add_file: sshkey_cert_copy: invalid argument
[DEPRECATION WARNING]: ANSIBLE_COLLECTIONS_PATHS option, does not fit var 
naming standard, use the singular form ANSIBLE_COLLECTIONS_PATH instead. This 
feature will be removed from ansible-core in version 2.19. Deprecation warnings
 can be disabled by setting deprecation_warnings=False in ansible.cfg.
Vault password: 
[WARNING]: Invalid characters were found in group names but not replaced, use
-vvvv to see details

PLAY [Validate input and add terminal hosts dynamically] ***********************

TASK [Validate required input variables] ***************************************
ok: [localhost] => {
    "changed": false,
    "msg": "All assertions passed"
}

TASK [Add every bastion to dynamic inventory] **********************************
ok: [localhost] => (item=GBARKAP82)
ok: [localhost] => (item=GBARKP51)
ok: [localhost] => (item=GBARKP54)

PLAY [LogX v2 - Discover OCP namespaces] ***************************************

TASK [Initialize result lists] *************************************************
ok: [GBARKAP82]
ok: [GBARKP51]
ok: [GBARKP54]

TASK [Select the cluster subset that belongs to this bastion] ******************
ok: [GBARKAP82]
ok: [GBARKP51]
ok: [GBARKP54]

TASK [Validate requested cluster records] **************************************
ok: [GBARKAP82] => (item=None)
ok: [GBARKAP82]
ok: [GBARKP51] => (item=None)
ok: [GBARKP51]
ok: [GBARKP54] => (item=None)
ok: [GBARKP54]

TASK [Resolve valid cluster connection records] ********************************
ok: [GBARKAP82] => (item=None)
ok: [GBARKAP82]
ok: [GBARKP51] => (item=None)
ok: [GBARKP51]
ok: [GBARKP54] => (item=None)
ok: [GBARKP54]

TASK [Check oc binary] *********************************************************
ok: [GBARKP54]
ok: [GBARKAP82]
ok: [GBARKP51]

TASK [Fail when oc binary is missing] ******************************************
fatal: [GBARKAP82]: FAILED! => {
    "assertion": "oc_binary_stat.stat.exists",
    "changed": false,
    "evaluated_to": false,
    "msg": "oc binary is missing or not executable: /usr/local/bin/oc"
}
fatal: [GBARKP51]: FAILED! => {
    "assertion": "oc_binary_stat.stat.exists",
    "changed": false,
    "evaluated_to": false,
    "msg": "oc binary is missing or not executable: /usr/local/bin/oc"
}
fatal: [GBARKP54]: FAILED! => {
    "assertion": "oc_binary_stat.stat.exists",
    "changed": false,
    "evaluated_to": false,
    "msg": "oc binary is missing or not executable: /usr/local/bin/oc"
}

PLAY RECAP *********************************************************************
GBARKAP82                  : ok=5    changed=0    unreachable=0    failed=1    skipped=0    rescued=0    ignored=0   
GBARKP51                   : ok=5    changed=0    unreachable=0    failed=1    skipped=0    rescued=0    ignored=0   
GBARKP54                   : ok=5    changed=0    unreachable=0    failed=1    skipped=0    rescued=0    ignored=0   
localhost                  : ok=2    changed=0    unreachable=0    failed=0    skipped=0    rescued=0    ignored=0   

hatasını aldı 

sunuculardan birine gittim

[uxmid@gbarkp51 - PROD - PENDIK - ARK GBOCPPROD1] $ which oc
/bin/oc
[uxmid@gbarkp51 - PROD - PENDIK - ARK GBOCPPROD1] $ oc
OpenShift Client

This client helps you develop, build, deploy, and run your applications on any
OpenShift or Kubernetes cluster. It also includes the administrative
commands for managing a cluster under the 'adm' subcommand.

Basic Commands:
  login             Log in to a server
  new-project       Request a new project
  new-app           Create a new application
  status            Show an overview of the current project
  project           Switch to another project
  projects          Display existing projects
  explain           Get documentation for a resource

Build and Deploy Commands:
  rollout           Manage a Kubernetes deployment or OpenShift deployment config
  rollback          Revert part of an application back to a previous deployment
  new-build         Create a new build configuration
  start-build       Start a new build
  cancel-build      Cancel running, pending, or new builds
  import-image      Import images from a container image registry
  tag               Tag existing images into image streams

Application Management Commands:
  create            Create a resource from a file or from stdin
  apply             Apply a configuration to a resource by file name or stdin
  get               Display one or many resources
  describe          Show details of a specific resource or group of resources
  edit              Edit a resource on the server
  set               Commands that help set specific features on objects
  label             Update the labels on a resource
  annotate          Update the annotations on a resource
  expose            Expose a replicated application as a service or route
  delete            Delete resources by file names, stdin, resources and names, or by resources and label selector
  scale             Set a new size for a deployment, replica set, or replication controller
  autoscale         Autoscale a deployment config, deployment, replica set, stateful set, or replication controller
  secrets           Manage secrets

Troubleshooting and Debugging Commands:
  logs              Print the logs for a container in a pod
  rsh               Start a shell session in a container
  rsync             Copy files between a local file system and a pod
  port-forward      Forward one or more local ports to a pod
  debug             Launch a new instance of a pod for debugging
  exec              Execute a command in a container
  proxy             Run a proxy to the Kubernetes API server
  attach            Attach to a running container
  run               Run a particular image on the cluster
  cp                Copy files and directories to and from containers
  wait              Experimental: Wait for a specific condition on one or many resources
  events            List events

Advanced Commands:
  adm               Tools for managing a cluster
  replace           Replace a resource by file name or stdin
  patch             Update fields of a resource
  process           Process a template into list of resources
  extract           Extract secrets or config maps to disk
  observe           Observe changes to resources and react to them (experimental)
  policy            Manage authorization policy
  auth              Inspect authorization
  image             Useful commands for managing images
  registry          Commands for working with the registry
  idle              Idle scalable resources
  api-versions      Print the supported API versions on the server, in the form of "group/version"
  api-resources     Print the supported API resources on the server
  cluster-info      Display cluster information
  diff              Diff the live version against a would-be applied version
  kustomize         Build a kustomization target from a directory or URL

Settings Commands:
  get-token         Experimental: Get token from external OIDC issuer as credentials exec plugin
  logout            End the current server session
  config            Modify kubeconfig files
  whoami            Return information about the current session
  completion        Output shell completion code for the specified shell (bash, zsh, fish, or powershell)

Other Commands:
  plugin            Provides utilities for interacting with plugins
  version           Print the client and server version information

Usage:
  oc [flags] [options]

Use "oc <command> --help" for more information about a given command.
Use "oc options" for a list of global command-line options (applies to all commands).
[uxmid@gbarkp51 - PROD - PENDIK - ARK GBOCPPROD1] $ 

sana hatayı ve buna dair log ve sonuçalrı attım bunlara bakarak sorunumuzu çözecek planlamayı ve taskları bütün ajanları kullanarak yap ve tasklarını oluştur.

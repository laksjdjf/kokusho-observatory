/*! script top by CRM group @ JMA */
var stationList = {}; //地点[地点名,ID]
var elementList = []; //要素名[要素名,ID]
var ymdList = [];
var interAnnualType = '1'; //期間の種類
var optionNumList = []; //オプションのリスト
var aggrgPeriod = "1"; //集計期間:デフォルトは日別=1
var ndaytype = 1; //
var rmkFlag = 1; //
var disconnectFlag = 1;
var csvFlag = 1;
var ymdLiteral = 1;
var kijiFlag = 0;
var huukouFlag = 0;
var youbiFlag = 0;
var fukenFlag = 0;
var jikantaiFlag = 0; //時別の時間帯指定:0=24時間:1=指定
var jikantaiList = [];
var stationNumList = []; //[地点番号]
var elementNumList = []; //[要素番号,変数]
var selectedTab = 0;
var minOpVal=1;//過去平均最小
var maxOpVal=30;//過去平均最大
var numOfOption = 0;
var numOfPeriod = 0;
var obs = ['ob_rain', 'ob_wind', 'ob_tmeter', 'ob_sun', 'ob_snow', 'ob_etc'];
var tag = ['降水量', '風', '気温', '日照時間', '積雪・降雪', 'その他'];
var day10 = {
    "1": "上旬",
    "2": "中旬",
    "3": "下旬"
};
var aggrgChar = {
    "1": "日",
    "2": "半旬",
    "3": "通年半旬",
    "4": "旬",
    "5": "月",
    "6": "3か月",
    "7": "年",
    "8": "日間",
    "9": "時"
};

var seigen = 44000; //制限値
var buttonValue = {"stationButton": 0, "elementButton": 1, "periodButton": 2, "optionButton": 3};
var now = new Date();
var yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
//var rooturl = "//" + location.hostname + "/~climat71/risk/obsdl/";
var rooturl = "//" + location.hostname + "/risk/obsdl/";
var errFlag = "0";

function setform(input, type, name, value) {
    input.setAttribute('type', type);
    input.setAttribute('name', name);
    input.setAttribute('value', value);
}

function getJsonLocalStorage(valName) {
    try{
        var val = (localStorage.getItem("obsdl_" + valName)) 
            ? JSON.parse(localStorage.getItem("obsdl_" + valName)) 
            : eval(valName);
    } catch(e){
        var val = eval(valName);
    }
    return val;
}

$(function() {
    stationList     = getJsonLocalStorage("stationList");
    elementList     = getJsonLocalStorage("elementList");
    ymdList         = getJsonLocalStorage("ymdList");
    aggrgPeriod     = getJsonLocalStorage("aggrgPeriod");
    ndaytype        = getJsonLocalStorage("ndaytype");
    optionNumList   = getJsonLocalStorage("optionNumList");
    interAnnualType = getJsonLocalStorage("interAnnualType");
    rmkFlag         = getJsonLocalStorage("rmkFlag");
    csvFlag         = getJsonLocalStorage("csvFlag");
    ymdLiteral      = getJsonLocalStorage("ymdLiteral");
    disconnectFlag  = getJsonLocalStorage("disconnectFlag");
    kijiFlag        = getJsonLocalStorage("kijiFlag");
    huukouFlag      = getJsonLocalStorage("huukouFlag");
    youbiFlag       = getJsonLocalStorage("youbiFlag");
    fukenFlag       = getJsonLocalStorage("fukenFlag");
    jikantaiFlag    = getJsonLocalStorage("jikantaiFlag");//console.log("jikantaiFlag="+ jikantaiFlag);
    jikantaiList    = getJsonLocalStorage("jikantaiList");
    if (sessionStorage.getItem('selectedTab')) {
        selectedTab = sessionStorage.getItem('selectedTab');
    }
    init();
    function init() {
        $('#table_content').css('display', 'none');
        mkdialog();
        if (ymdList.length == 0) {
            if (aggrgPeriod == 9){
                changePeriod('1m');
            }else{
                changePeriod('1y');
            }
        }
        if (location.hash == '#!table') {
            openDialog('#wait');
            if ($.isEmptyObject(stationList)) {
                alert("地点が選択されていません");
                loadTop();
            } else if (elementList.length == 0) {
                alert("要素が選択されていません");
                loadTop();
            } else if (ymdList.length == 0) {
                alert("期間が選択されていません");
                loadTop();
            } else {
                if (localStorage.getItem('obsdl_errFlag')) {
                    errFlag = localStorage.getItem('obsdl_errFlag');
                    localStorage.setItem('obsdl_errFlag', "0");
                }
                if (errFlag == "0") {
                    loadTable();
                } else {
                    closeDialog("#wait");
                    location.hash = "";
                }
            }
            //loadTable(1);
        } else {
            if (stationList)
                viewSelectedStation();
            if (elementList)
                viewSelectedElement();
            if (optionNumList)
                viewSelectedOption();
            viewSelectedViewOption();
            changeInputFlag();
            callAjaxStation("00", "#stationArea");
            callAjaxElement("#elementArea");
            callAjaxPeriod(interAnnualType, "#periodArea");
            changePanel(selectedTab);
            viewSelectedPeriod();
            var nOf = getNum();
            getErr(nOf[0], nOf[1], nOf[2], nOf[3]);
        }
        if (window.document.referrer)
            ;
    }

    $('body').on('mouseenter', 'img.rollover', function() {
        $(this).attr('src', $(this).attr("src").replace(/(\_1|\_3)/, "_2"));
    });
    $('body').on('mouseleave', 'img.rollover', function() {
        $(this).attr('src', $(this).attr("src").replace("_2", "_1"));
    });
    window.addEventListener('hashchange', (e) => {
        if (location.hash === '#!table') {
            loadTable(1);
        } else {
            if (sessionStorage.getItem('obsdl_selectedTab')) {
                selectedPanel = sessionStorage.getItem('obsdl_selectedPanel');
            }
            sessionStorage.clear();
            loadTop();
            init();
        }
    });

    $('body').on("click", ".selectButton", function() {
        changePanel(buttonValue[$(this).attr('id')]);
    });
    //県の移動
    $('body').on('click', 'div.movepr', function() {
        callAjaxStation($(this).children('input[name=stid]').val().slice(1), "#stationArea");
    });
    //府県の選択へ戻る
    $('body').on('click', '#buttonSelectStation', function() {
        callAjaxStation("00", "#stationArea");
    });
    //府県を選択すると地点の選択へ
    $('body').on('click', '#stationArea td.pref', function() {
        callAjaxStation($(this).find('input').val(), "#stationArea");
    });
    $('#main').on('click', '#buttonDelAll', clearselected);
    $('#main').on('click', '#buttonDelStation', clearStation); //地点選択をクリア
    $('#main').on('click', '#buttonDelElement', clearElement); //要素選択をクリア
    //フォーカスの線を消す
    $('body').on('click', '#eltab a', function() {
        this.blur();
    });
    //地点をクリック
    $('body').on('click', 'div.station', function() {
        addOneStation($(this));
    });
    //パネル切り替え左
    $('body').on('click', '#leftPanelButton', function() {
        changePanel((parseInt(selectedTab) - 1 == -1) ? 3 : parseInt(selectedTab) - 1);
    });
    //パネル切り替え右
    $('body').on('click', '#rightPanelButton', function() {
        changePanel((parseInt(selectedTab) + 1 == 4) ? 0 : parseInt(selectedTab) + 1);
    });
    //地点削除ボタン
    $('body').on('click', 'input.delSt', function() {
        delete stationList[ $(this).parent('div').attr('id')];
        localStorage.setItem('obsdl_stationList', JSON.stringify(stationList));
        viewSelectedStation();
        checkSelectedStation();
        selectedPrefecture();
        var nOf = getNum();
        getErr(nOf[0], nOf[1], nOf[2], nOf[3]);
    });
    //要素削除ボタン
    $('body').on('click', 'input.delEl', function() {
        var val = $(this).prev('input').val();
        for (i = 0; i < elementList.length; i++) {
            if ($.inArray(val, elementList[i]) != -1)
                elementList.splice(i, 1);
        }
        localStorage.setItem('obsdl_elementList', JSON.stringify(elementList));
        checkSelectedElement();
        viewSelectedElement();
        var nOf = getNum();
        getErr(nOf[0], nOf[1], nOf[2], nOf[3]);
    });
    //要素のチェックボックス
    $('body').on('click', 'input.elem', function() {
        var nOf = getNum();
        addElementList();
        viewSelectedElement();
        if ($(this).prop('checked')) {
            getErr(nOf[0], nOf[1] + 1, nOf[2], nOf[3]);
        } else {
            getErr(nOf[0], nOf[1] - 1, nOf[2], nOf[3]);
        }
    });
    //トップページに移動
    $('body').on('click', '#loadTop', function() {
        loadTop();
    });

    // 集計期間ラジオボタン変更に応じてテキスト変更
    $('body').on('change', 'input[name=aggrgPeriod]', function() {
        aggrgPeriod = $(this).val();

        if (aggrgPeriod == 8) {
            aggrgPeriod = aggrgPeriod + ndaytype + $(this).next('span').children("input,select").val();
        }

        if (aggrgPeriod == 2 || aggrgPeriod == 4) {
            ymdList[4] = 1;
            ymdList[5] = 1;
            localStorage.setItem('obsdl_ymdList', JSON.stringify(ymdList));
        } else  if (aggrgPeriod == 5 || aggrgPeriod == 6) {
            ymdList[4] = 1;
            ymdList[5] = 1;
            localStorage.setItem('obsdl_ymdList', JSON.stringify(ymdList));
        }

        if (aggrgPeriod == 9) {
            const disableList = ["op1", "op2", "op3", "op4"];

            // optionNumListにはop0のみ残す
            optionNumList = optionNumList.filter(option => 
                !disableList.includes(option[0])
            );

            viewSelectedOption();
            localStorage.setItem('obsdl_optionNumList', JSON.stringify(optionNumList));
            viewSelectedViewOption();
            localStorage.setItem('obsdl_kijiFlag', kijiFlag);
        }

        // 共通処理
        callAjaxElement("#elementArea");
        callAjaxPeriod(interAnnualType, "#periodArea");
        viewSelectedPeriod();

        const nOf = getNum();
        getErr(nOf[0], nOf[1], nOf[2], nOf[3]);
    });

   function changePanel(val) {
        var panel = ["station", "element", "period", "option"];
        var button = $("#" + panel[val] + "Button");
        $(".selectPanel").hide();
        $(".selectButton").addClass('rollover').each(function() {
            $(this).attr('src', $(this).attr("src").replace(/(\_2|\_3)/, "_1"));
        });
        button.removeClass('rollover').attr('src', button.attr("src").replace(/(\_2|\_1)/, "_3"));
        $("#" + panel[val] + "Area").show();
        selectedTab = val;
        window.sessionStorage.setItem("obsdl_selectedTab", val);
    }


    function  clearStation() {
        stationList = {};
        viewSelectedStation();
        $('div.station').removeClass('selectedst');
        localStorage.setItem('obsdl_stationList', JSON.stringify(stationList));
        $('td.pref').removeClass('selectedPrefecture');
        var nOf = getNum();
        getErr(nOf[0], nOf[1], nOf[2], nOf[3]);
    }

    function clearElement() {
        $('input.elem').prop('checked', false).next('span').removeClass('checked');
        elementList.length = 0;
        viewSelectedElement();
        localStorage.setItem('obsdl_elementList', JSON.stringify(elementList));
        $('#comprOption input').prop('checked', false).next('span').removeClass('checked');
        optionNumList.length = 0;
        viewSelectedOption();
        localStorage.setItem('obsdl_optionNumList', JSON.stringify(optionNumList));
        var nOf = getNum();
        getErr(nOf[0], nOf[1], nOf[2], nOf[3]);
    }
//全選択要素を削除
    function clearselected() {
        clearStation();
        clearElement();
        //ymdList.length=0;
        optionNumList.length = 0;
        getErr(0, 0, countPrNum(aggrgPeriod, interAnnualType, ymdList, jikantaiList), 1);
    }

//選択されているFlagのところにチェック
    function changeInputFlag() {
        const flagNames = ['rmkFlag', 'disconnectFlag', 'csvFlag', 'ymdLiteral', 'youbiFlag', 'fukenFlag'];
        for (const name of flagNames) {
            $(`input[name=${name}][value=${window[name]}]`)
              .prop("checked", true)
              .next('span')
              .addClass('checked');
        }

        if (youbiFlag != 1) {
            $('input[name=youbiFlag]').prop("checked", false).next('span').removeClass('checked');
        }
        if (fukenFlag != 1) {
            $('input[name=fukenFlag]').prop("checked", false).next('span').removeClass('checked');
        }
        if (csvFlag == 0) {
            $('input[name="ymdLiteral"]').attr('disabled', 'disabled').next('span').removeClass('checked').parent('p').addClass('unselectedkikan');
        }
    }

    function changeKijiFlag() {
        if (kijiFlag == 1) {
            $('input[name=kijiFlag]').prop("checked", true).next('span').addClass('checked');
            //console.log("kiji1");
        } else {
            $('input[name=kijiFlag]').prop("checked", false).next('span').removeClass('checked');
            //console.log("kiji0");
        }
    }

//カスタムモーダル（jquery-ui不要）
    var dialogInitialized = false;

    function mkdialog() {
        if (dialogInitialized) return;

        const $wait = $("#wait");
        $wait.css({
            display: 'none',
            position: 'fixed',
            width: '330px',
            height: '150px',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            backgroundColor: '#fff',
            border: '1px solid #ccc',
            boxShadow: '0 4px 8px rgba(0,0,0,0.2)',
            zIndex: 10000,
            padding: '20px',
            boxSizing: 'border-box'
        });

        // モーダルオーバーレイを追加
        if ($('#wait-overlay').length === 0) {
            $('<div id="wait-overlay"></div>').css({
                display: 'none',
                position: 'fixed',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                backgroundColor: 'rgba(0,0,0,0.5)',
                zIndex: 9999
            }).insertBefore($wait);
        }

        dialogInitialized = true;
    }

    // グローバルなダイアログヘルパー関数
    function openDialog($element) {
        if (!dialogInitialized) mkdialog();
        $('#wait-overlay').css('display', 'block');
        // $elementが既にjQueryオブジェクトの場合とセレクタ文字列の場合を両方サポート
        if (typeof $element === 'string') {
            $($element).css('display', 'block');
        } else {
            $element.css('display', 'block');
        }
    }

    function closeDialog($element) {
        if (!dialogInitialized) mkdialog();
        $('#wait-overlay').css('display', 'none');
        // $elementが既にjQueryオブジェクトの場合とセレクタ文字列の場合を両方サポート
        if (typeof $element === 'string') {
            $($element).css('display', 'none');
        } else {
            $element.css('display', 'none');
        }
    }


//--------------------------------------
// 地点選択関連 
//--------------------------------------
//選択済の地点をチェック
    function checkSelectedStation() {
        $('div.station').removeClass('selectedst');
        $('div.station').each(function() {
            if (stationList[$(this).children("input[name=stid]").val()])
                $(this).addClass('selectedst');
        });
        if ($('div.station.stmark').length == $('div.station.selectedst.stmark').length)
            $("div.selectallst").addClass('selectedst');
    }

    var stations;
    function callAjaxStation(pd, selector) {
        $.ajax({
            type: 'post',
            url: rooturl+'top/station',
            dataType: 'html',
            data: {
                "pd": pd
            },
            success: function(data, textStatus) {
                $(selector).html(null).html(data);
                if (pd != "00") {
                    checkSelectedStation();
                    stations = $("#stationMap div.station");
                } else {
                    selectedPrefecture();
                }
            }
        });
    }



//変数にある地点を選択地点一覧に追加
    function viewSelectedStation() {
        var str = "";
        if ($.isEmptyObject(stationList)) {
            $('#selectedStationList').addClass('empty');
            str = "<img src=web/img/yajirushi.png>地点を選択してください";
        } else {
            $('#selectedStationList').removeClass('empty');
            var sort = [2, 0, 3, 4, 1, 5];
            $.each(stationList, function(key) {
                var kansoku = $(this)[3];
                var imgtag = '';
                if (kansoku) {
                    for (i = 0, len = kansoku.length; i < len; i++) {
                        if (kansoku.substr(sort[i], 1) == 1 || kansoku.substr(sort[i], 1) == 2) {
                            imgtag += `<img src="web/img/${obs[sort[i]]}.gif" alt="${tag[sort[i]]}" title="${tag[sort[i]]}">`;
                        } else {
                            imgtag += '<img src="web/img/none.gif">';
                        }
                    }
                }

                str = str + '<div title="' + $(this)[0] + '" class="clearfix"><div class="selectedStText">' + $(this)[0]
                        + '</div><div class=selectedStObs>' + imgtag + '</div><div class="selectedStButton" id="' + $(this)[1]
                        + '"><input type="submit" class="delSt" value="削除"></div></div>';
            });
        }
        $('#selectedStationList').html(str).scrollTop($(this).height());
    }


//選択された地点を変数、ローカルストレージに追加。チェックマーク表示。
    function addStationList(station) {
        var stid = station.children("input[name=stid]");
        var val = stid.val();
        stationList[val] = [
          station.children("input[name=stname]").val(), 
          stid.val(),
          station.children("input[name=prid]").val(),
          station.children("input[name=kansoku]").val()
        ];
        localStorage.setItem('obsdl_stationList', JSON.stringify(stationList));
    }

    function rmStationList(station) {
        delete stationList[ station.children("input[name=stid]").val()];
        localStorage.setItem('obsdl_stationList', JSON.stringify(stationList));
    }



    function addOneStation(targ) {
        var nOf = getNum();
        if (targ.hasClass('selectedst')) {
            var val = targ.children('input').val();
            targ.removeClass('selectedst');
            stations.children(`input[value="${val}"]`).parent('div.station').removeClass('selectedst');
            rmStationList(targ);
            $("#stationMap div.selectallst").removeClass('selectedst');
            getErr(nOf[0] - 1, nOf[1], nOf[2], nOf[3]);
        } else {
            var val = targ.children('input').val();
            $(`#stationMap div.station:not(".selectedst") input[value="${val}"]`).parent('div.station').addClass('selectedst');
            targ.addClass("selectedst");
            addStationList(targ);
            //全ての地点が選択されている場合
            if ($('#stationMap div.station div.stmark').length == $('#stationMap div.station.selectedst.stmark').length) {
                $("div.selectallst").addClass('selectedst');
            }
            getErr(nOf[0] + 1, nOf[1], nOf[2], nOf[3]);
        }
        viewSelectedStation();
        // selectedPrefecture();
    }


//全ての地点を選択
    $('body').on('click', 'div.selectallst', function() {
        if (!$(this).hasClass('selectedst')) {
            $(this).addClass('selectedst');
            stations.addClass('selectedst');
            $('#stationMap div.station.selectedst').each(function() {
                var ths = $(this);
                var stid = ths.children("input[name=stid]").val();
                if (!stationList[stid]) {
                    stationList[stid] = [
                      ths.children("input[name=stname]").val(),
                      stid,
                      ths.children("input[name=prid]").val(),
                      ths.children("input[name=kansoku]").val()
                    ];
                }
            });
        } else {
            $(this).removeClass('selectedst');
            $('div.station.selectedst').each(function() {
                delete stationList[$(this).children("input[name=stid]").val()];
            });
            $('div.station.selectedst').removeClass('selectedst');
        }
        localStorage.setItem('obsdl_stationList', JSON.stringify(stationList));
        viewSelectedStation();
        var nOf = getNum();
        getErr(nOf[0], nOf[1], nOf[2], nOf[3]);
    });
    $('body').on('click', '#deleteAllStPref', function() {
        $('div.station.selectedst').each(function() {
            delete stationList[ $(this).children("input[name=stid]").val()];
        });
        $('div.station.selectedst').removeClass('selectedst');
        localStorage.setItem('obsdl_stationList', JSON.stringify(stationList));
        viewSelectedStation();
        var nOf = getNum();
        getErr(nOf[0], nOf[1], nOf[2], nOf[3]);
    });
    function selectedPrefecture() {
        $('#prefectureTable td.pref').removeClass('selectedPrefecture');
        $.each(stationList, function(key) {
            $('#pr' + $(this)[2]).parent("td").addClass('selectedPrefecture');
        });
    }



//--------------------------------------
// 要素選択関連 
//--------------------------------------
    function checkSelectedElement() {
        // 全てのチェックを外す
        $('input.elem')
            .prop('checked', false)
            .next('span')
            .removeClass('checked');

        // 有効な要素をチェック
        $('input:enabled.elem').each(function() {
            const $input = $(this);
            const inputVal = $input.val();

            // elementListから一致する要素を検索
            const matchedElement = elementList.find(element => 
                element.includes(inputVal)
            );

            if (matchedElement) {
                // 608または609の場合は値を10で割る
                const val = (matchedElement[1] === 608 || matchedElement[1] === 609) 
                    ? matchedElement[2] / 10 
                    : matchedElement[2];

                $input
                    .prop('checked', true)
                    .next('span')
                    .addClass('checked')
                    .end()
                    .parents('td')
                    .find('input.inumber:not([type=hidden]), select.inumber')
                    .val(val);
            }
        });

        // aggrgPeriodの設定
        const tmp = aggrgPeriod.slice(0, 1);
        $(`input[name="aggrgPeriod"][value="${tmp}"]`).prop('checked', true);

        if (tmp == 8) {
            $('input[name="nday"], select[name="nday"]').val(aggrgPeriod.slice(2));
        }

        $("span.eltxt3").html(getAggrgPeriod(aggrgPeriod));
    }

    function callAjaxElement(selector) {
        // カスタムタブ実装（jquery-ui不要）
        const $eltab = $("#eltab");
        let selectedTab = 0;

        // 現在アクティブなタブのインデックスを取得
        if ($eltab.length > 0) {
            $eltab.find('.ui-tabs-nav li').each(function(index) {
                if ($(this).hasClass('ui-tabs-active') || $(this).hasClass('active')) {
                    selectedTab = index;
                }
            });
        }

        $.ajax({
            type: 'post',
            url: rooturl + 'top/element',
            dataType: 'html',
            data: {
                aggrgPeriod: aggrgPeriod
            },
            success: function(data) {
                $(selector).html(data);
                checkSelectedElement();
                chAggrgPeriod();

                elementList.length = 0;
                addElementList();

                // カスタムタブ初期化
                initCustomTabs('#eltab', selectedTab);

                checkSelectedOption();
                changeKijiFlag();
            }
        });
    }

    // カスタムタブ初期化関数
    function initCustomTabs(selector, activeIndex) {
        const $tabs = $(selector);
        const $tabLinks = $tabs.find('.ui-tabs-nav a, ul.ui-tabs-nav a');
        const $tabPanels = $tabs.find('> div.ui-tabs-panel, > div.ellist');

        if ($tabLinks.length === 0 || $tabPanels.length === 0) {
            console.warn('Custom tabs: No tabs or panels found');
            return;
        }

        // 全てのパネルを非表示
        $tabPanels.hide();

        // 全てのタブからアクティブクラスを削除
        $tabLinks.parent().removeClass('ui-tabs-active active');

        // 指定されたタブをアクティブに
        if (activeIndex >= 0 && activeIndex < $tabLinks.length) {
            $tabLinks.eq(activeIndex).parent().addClass('active');
            const href = $tabLinks.eq(activeIndex).attr('href');
            if (href) {
                $(href).show();
            }
        } else if ($tabLinks.length > 0) {
            // デフォルトで最初のタブをアクティブに
            $tabLinks.eq(0).parent().addClass('active');
            const href = $tabLinks.eq(0).attr('href');
            if (href) {
                $(href).show();
            }
        }

        // タブクリックイベント
        $tabLinks.off('click.customtabs').on('click.customtabs', function(e) {
            e.preventDefault();
            const href = $(this).attr('href');

            // 全てのタブとパネルを非アクティブに
            $tabLinks.parent().removeClass('ui-tabs-active active');
            $tabPanels.hide();

            // クリックされたタブをアクティブに
            $(this).parent().addClass('active');
            if (href) {
                $(href).show();
            }
        });
    }

    function addElementList() {
        elementList = getJsonLocalStorage("elementList");//再宣言が必要
        //console.log("elementList.length.start="+elementList.length);
        var myelem=[];//選択項目用配列

        $('input:enabled.elem').each(function() {
            if ($(this).prop('checked')) {
                $(this).next('span').addClass('checked');
                thispar = $(this).parent('div,td');
                //str=thispar.text();
                val = thispar.find('input.inumber,select.inumber').val(); //'value')
                if (val == undefined) {
                    val = "";
                }
                strkikan = getAggrgPeriod(aggrgPeriod);
                thispar.find("span.eltxt3").html(strkikan);
                str1 = thispar.find('span.eltxt1').text();
                str2 = thispar.find('span.eltxt2').text();
                switch ($(this).val()) {//例外
                    case '103':
                    case '403':
                        if (val == "0") {
                            pval = "0";
                            txval = "0.0";
                        } else if (val == "05") {
                            pval = "05";
                            txval = "0.5";
                        } else if (val == "01") {
                            pval = "01";
                            txval = "0.1";
                        } else {
                            pval = val;
                            txval = val;
                        }
                        break;
                    case '105':
                        if (val == 10) {
                            str2 = '分間' + str2;
                        } else {
                            str2 = '時間' + str2;
                        }
                        pval = val;
                        txval = pval;
                        break;
                    case '608':
                    case '609':
                        pval = val * 10;
                        txval = val;
                        break;
                    default:
                        pval = val;
                        txval = pval;
                }
                str = str1 + txval + str2;
                elflag = false;

                myelem.push( $(this).val() );//選択要素を記録する

                for (i = 0; i < elementList.length; i++) {
                    if ($(this).val() == elementList[i][1]) {
                        elementList[i] = [str, $(this).val(), pval];
                        elflag = true;
                        break;
                    }
                }
                if (!elflag) {
                    elementList.push([str, $(this).val(), pval]);
                }
            } else {
                $(this).next('span').removeClass('checked');
            }

        });

        elementList = elementList.filter( function (item) {
            const exists = myelem.includes(item[1]);
            return exists === true;
        });

        localStorage.setItem('obsdl_elementList', JSON.stringify(elementList));
        viewSelectedElement();
    }

//変数にある要素を選択要素一覧に追加
    function viewSelectedElement() {
        str = "";
        if (elementList.length == 0) {
            $('#selectedElementList').addClass('empty');
            $('#elementButton').addClass('empty');
            str = "<img src=web/img/yajirushi.png>項目を選択してください";
        } else {
            $('#selectedElementList').removeClass('empty');
            $('#elementButton').removeClass('empty');
            var length = elementList.length;
            for (i = 0; i < length; i++) {
                str = str + `<div class="clearfix"><div title="${elementList[i][0]}" class="selectedElText">${elementList[i][0]}`
                        + `</div><div class="selectedElButton" id="${elementList[i][1]}"><input type="hidden" value="${elementList[i][1]}`
                        + '"><input type="submit" class="delEl" value="削除"></div></div>';
            }
        }
        $('#selectedElementList').html(str).scrollTop($(this).height());
    }


//要素選択のテキストボックスを変えるとelementListと選択済みテキスト更新
    $('body').on('change', 'input.inumber,select.inumber', function() {//IEだと矢印がinputの外にある！
        if ($(this).parents('td').find('input.elem').prop('checked')) {
            for (i = 0; i < elementList.length; i++) {
                if (elementList[i][1] == $(this).parents('td').find('input.elem').val()) {
                    elementList.splice(i, 1);
                }
            }
            addElementList();
        }
    });
    //集計期間変更に応じた要素変更
    function chAggrgPeriod() {
        eltmp = aggrgPeriod.slice(0, 1);
        $('input[name=aggrgPeriod]').next('span').removeClass('checked');
        $('input[name=aggrgPeriod][value=' + eltmp + ']').next('span').addClass('checked');
        $('td.elel').addClass('unselectedkikan');
        $('td.elel.kikan' + eltmp).removeClass('unselectedkikan').addClass('selectedkikan');
        $("td.elel.selectedkikan input , td.selectedkikan select").removeAttr('disabled');
        $("td.elel.unselectedkikan input , td.unselectedkikan select").attr('disabled', 'disabled').prop('checked', false).next('span').removeClass('checked');
        localStorage.setItem('obsdl_aggrgPeriod', JSON.stringify(aggrgPeriod));
        //addElementList();
    }



    //集計期間に応じて要素にクラスを付加
    function addSelectedClass2Element() {
        var eltmp = aggrgPeriod.slice(0, 1);
        $('td.elel').addClass('unselectedkikan');
        $('td.elel.kikan' + eltmp).removeClass('unselectedkikan').addClass('selectedkikan');
    }


    $('body').on('change', 'input[name=nday] , select[name=nday]', function() {
        var nday = $(this).val();
        if (nday < minOpVal) {
            nday = minOpVal;
        } else if (nday > maxOpVal){
            nday = maxOpVal;
        }
        aggrgPeriod = "8" + ndaytype + nday;
        //   $('input[name="aggrgPeriod"]').next('span').removeClass('checked');
        $('.nday').html(nday);
        callAjaxElement("#elementArea");
        callAjaxPeriod(interAnnualType, "#periodArea");
        // addOptionList();
        //viewSelectedOption();
        viewSelectedPeriod();
        var nOf = getNum();
        getErr(nOf[0], nOf[1], nOf[2], nOf[3]);
    });
    //N日別の連続かN日おきか
    $('body').on('change', 'input[name="ndaytype"]:checked', function() {
        $('input[name="ndaytype"]').next('span').removeClass('checked');
        $(this).next('span').addClass('checked');
        ndaytype = $('input[name="ndaytype"]:checked').val();
        aggrgPeriod = "8" + ndaytype + aggrgPeriod.slice(2);
        chAggrgPeriod();
        localStorage.setItem('obsdl_ndaytype', JSON.stringify(ndaytype));
        var nOf = getNum();
        getErr(nOf[0], nOf[1], nOf[2], nOf[3]);
    });
    
    function callAjaxPeriod(interAnnualType, selector) {
        $.ajax({
            type: 'post',
            url: rooturl + 'top/period',
            dataType: 'html',
            data: {
                aggrgPeriod: aggrgPeriod,
                interAnnualType: interAnnualType
            },
            success: function(data) {
                $(selector).html(data);

                if (ymdList.length === 0) {
                    changePeriod(aggrgPeriod == 9 ? "1m" : "1y");
                }

                // periodcopyのselect要素を一括生成
                const copyIds = ['inim', 'endm', 'inid', 'endd', 'endy'];
                const selectElements = copyIds.map(id =>
                    `<select id="${id}copy" style="display:none;"></select>`
                ).join('');
                $('#periodcopy').html(selectElements);

                // 各select要素の子要素をclone
                copyIds.forEach(id => {
                    $(`select[name="${id}"]`).eq(0).children().clone().prependTo(`#${id}copy`);
                });

                changeInputPeriod();
                if (aggrgPeriod == 9) setJikantai();
            }
        });
    }

    $('body').on('change', 'div.selectpr select', function() {
        changePeriodSelectOption();
        insertymd();
        viewSelectedPeriod();
        var nOf = getNum();
        getErr(nOf[0], nOf[1], nOf[2], nOf[3]);
    });
    function changePeriodSelectOption() {
        aggrgType = parseInt(aggrgPeriod[0]);

        var iniy = $(`.interAnnualType${interAnnualType} select[name="iniy"]`).val();
        var inim = $(`.interAnnualType${interAnnualType} select[name="inim"]`).val();
        var inid = $(`.interAnnualType${interAnnualType} select[name="inid"]`).val();

        var endy = $(`.interAnnualType${interAnnualType} select[name="endy"]`).val();
        var endm = $(`.interAnnualType${interAnnualType} select[name="endm"]`).val();
        var endd = $(`.interAnnualType${interAnnualType} select[name="endd"]`).val();

        var max1,max1ini, maxdend,maxiend, maxdini, maxdend;
        var now = new Date();
        var yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
        var latestYear = yesterday.getFullYear();
        var ymonth = yesterday.getMonth() + 1;
        if (interAnnualType === 1) {//連続期間で表示
            maxiend = (iniy == latestYear) ? ymonth : 12; //開始月の最大
            inim = (inim > max1) ? maxiend : inim;

            maxdend = (endy == latestYear) ? ymonth : 12; //終了月の最大
            endm = (endm > maxdend) ? maxdend : endm;

            if ([1, 2, 4, 8, 9].includes(aggrgType)) {
                if ([2, 4].includes(aggrgType)) { //暦日半旬,旬
                    if (iniy == latestYear && inim == ymonth)
                        maxdini = caldDayValue(yesterday.getDate(), aggrgType);
                    if (endy == latestYear && endm == ymonth)
                        maxdend = calcDayValue(yesterday.getDate(), aggrgType);
                } else { //暦日半旬・旬別値以外
                    maxdini = (iniy == latestYear && inim == ymonth) ? yesterday.getDate() : new Date(iniy, inim, 0).getDate();
                    maxdend = (endy == latestYear && endm == ymonth) ? yesterday.getDate() : new Date(endy, endm, 0).getDate();
                }
                inid = (inid > maxdini) ? maxdini : inid;
                endd = (endd > maxdend) ? maxdend : endd;
                $(`.interAnnualType${interAnnualType} select[name="inid"]`).children().remove();
                $('#inidcopy').children().each(function() {
                    if ($(this).val() > maxdini) {
                        return;
                    } else {
                        $(`.interAnnualType${interAnnualType} select[name="inid"]`).append($(this).clone());
                    }
                });
                $('.interAnnualType' + interAnnualType + ' select[name="inid"]').val(inid);

                $('.interAnnualType' + interAnnualType + ' select[name="endd"]').children().remove();
                $('#enddcopy').children().each(function() {
                    if ($(this).val() > maxdend) {
                        return;
                    } else {
                        $('.interAnnualType' + interAnnualType + ' select[name="endd"]').append($(this).clone());
                    }
                });
                $('.interAnnualType' + interAnnualType + ' select[name="endd"]').val(endd);
            }

            $(`.interAnnualType${interAnnualType} select[name="inim"]`).children().remove();
            $('#inimcopy').children().each(function() {
                if ($(this).val() > maxiend) {
                    return;
                } else {
                    $(`.interAnnualType${interAnnualType} select[name="inim"]`).append($(this).clone());
                }
            });
            $(`.interAnnualType${interAnnualType} select[name="inim"]`).val(inim);

            $(`.interAnnualType${interAnnualType} select[name="endm"]`).children().remove();
            $('#endmcopy').children().each(function() {
                if ($(this).val() > maxdend) {
                    return;
                } else {
                    $('.interAnnualType' + interAnnualType + ' select[name="endm"]').append($(this).clone());
                }
            });
            $('.interAnnualType' + interAnnualType + ' select[name="endm"]').val(endm);
        } else {//経年変化
            if (iniy > endy){
                endy = iniy ;
                //alert("開始年より終了年が小さいです。");
            }
            maxyend = calcAcrossYearMaxYear(aggrgType, endm, endd, yesterday);
            maxyini = calcAcrossYearMaxYear(aggrgType, inim, inid, yesterday);

            if ([1, 8, 9].includes(aggrgType)) {
                maxdend = (new Date(2012, endm, 0)).getDate() ; // 閏年にも対応するため、2012年に固定
                maxiend = (new Date(2012, inim, 0)).getDate() ;
            } else if (aggrgType === 2) {
                maxdend = 6;
                maxiend = 6;
            } else if (aggrgType === 4) {
                maxdend = 3;
                maxiend = 3;
            } else if ([5, 6].includes(aggrgType)) {
                maxdend = 1;
                maxiend = 1;
                endd = 1;
                inid = 1;
            }

            iniy = (iniy > maxyend) ? maxyend : iniy;
            iniy = (iniy > maxyini) ? maxyini : iniy;
            inid = (inid > maxiend) ? maxiend : inid;

            endy = (endy > maxyend) ? maxyend : endy;
            endy = (iniy > maxyini) ? maxyini : endy;
            endd = (endd > maxdend) ? maxdend : endd;
            $('.interAnnualType2 select[name="endd"]').children().remove();
            $('#enddcopy').children().each(function() {
                if ($(this).val() > maxdend) {
                    return;
                } else {
                    $('.interAnnualType2 select[name="endd"]').append($(this).clone());
                }
            });
            $('.interAnnualType2 select[name="inid"]').children().remove();
            $('#inidcopy').children().each(function() {
                if ($(this).val() > maxiend) {
                    return;
                } else {
                    $('.interAnnualType2 select[name="inid"]').append($(this).clone());
                }
            });
            $('.interAnnualType2  select[name="iniy"],.interAnnualType2 select[name="endy"]').children('option[value="' + latestYear + '"]').remove();
            if (Math.min(maxyend,maxyini) == latestYear) {
                $('.interAnnualType2 select[name="endy"],.interAnnualType2 select[name="iniy"]').prepend($('#endycopy option[value="' + latestYear + '"]').clone());
            }
            $('.interAnnualType' + interAnnualType + ' select[name = "endd"]').val(endd);
            $('.interAnnualType' + interAnnualType + ' select[name = "inid"]').val(inid);
            $('.interAnnualType' + interAnnualType + ' select[name = "endm"]').val(endm);
            $('.interAnnualType' + interAnnualType + ' select[name = "iniy"]').val(iniy);
            $('.interAnnualType' + interAnnualType + ' select[name = "endy"]').val(endy);
        }
    }

    function changeInputPeriod() {
        var arr = ymdList;
        $(' select[name="endy"]').val(arr[1]);
        $(' select[name="endm"]').val(arr[3]);
        $(' select[name="endd"]').val(arr[5]);
        $(' select[name="iniy"]').val(arr[0]);
        $(' select[name="inim"]').val(arr[2]);
        $(' select[name="inid"]').val(arr[4]);
        if (aggrgPeriod.slice(0, 1) == "8") {
	    $('input[name="ndaytype"][value="' + ndaytype + '"]').prop('checked', true).next('span').addClass('checked');
        }
        $('input[name="interAnnualType"][value=' + interAnnualType + ']').prop('checked', true).next('span').addClass('checked');
        if (interAnnualType == 1) {
            $('.selectpr.interAnnualType1 select , .selectpr.interAnnualType1 input').prop('disabled', false);
            $('.selectpr.interAnnualType2 select').prop('disabled', true);
        } else {
            $('.selectpr.interAnnualType2 select').prop('disabled', false);
            $('.selectpr.interAnnualType1 select , .selectpr.interAnnualType1 input').prop('disabled', true);
        }
        changePeriodSelectOption();
        //以下、localstorage改ざん対策
        insertymd();
        viewSelectedPeriod();
        var nOf = getNum();
        getErr(nOf[0], nOf[1], nOf[2], nOf[3]);
    }


    $('body').on('change', 'input[name="interAnnualType"]', function() {
        interAnnualType = $(this).val();
        $('input[name="interAnnualType"]').next('span').removeClass('checked');
        if (interAnnualType == 1) {
            $('input[name="interAnnualType"][value="1"]').next('span').addClass('checked');
            $('.selectpr.interAnnualType1 select , .selectpr.interAnnualType1 input').prop('disabled', false);
            $('.selectpr.interAnnualType2 select').prop('disabled', true);
        } else {
            $('input[name="interAnnualType"][value="2"]').next('span').addClass('checked');
            $('.selectpr.interAnnualType2 select').prop('disabled', false);
            $('.selectpr.interAnnualType1 select , .selectpr.interAnnualType1 input').prop('disabled', true).next('span').removeClass('checked');
        }
            $('input[name="ndaytype"]:checked').next('span').addClass('checked');
        changePeriodSelectOption();
        insertymd();
        var nOf = getNum();
        getErr(nOf[0], nOf[1], nOf[2], nOf[3]);
        viewSelectedPeriod();
        localStorage.setItem('obsdl_interAnnualType', JSON.stringify(interAnnualType));
    });
    
    //時間帯指定ありなし
    $('body').on('change', 'input[name="jikantaiFlag"]', function() {
        //jikantaiFlag = $(this).val();
        if (!$('input[name="jikantaiFlag"]').prop('checked')) {
            jikantaiFlag = 0;
            $(this).next('span').removeClass('checked');
        } else {
            jikantaiFlag = 1;
            $(this).next('span').addClass('checked');
        }
        $('input[name="jikantaiFlag"]').next('span').removeClass('checked');
        if (jikantaiFlag == 1) {
            $('input[name="jikantaiFlag"]').next('span').addClass('checked');
            $('.selectpr.jikantaiFlag select').prop('disabled', false);
            $('.selectpr.jikantaiFlag span').removeClass('unselectedkikan');
        } else {
            $('input[name="jikantaiFlag"]').next('span').removeClass('checked');
            $('.selectpr.jikantaiFlag select').prop('disabled', true);
            $('.selectpr.jikantaiFlag span').addClass('unselectedkikan');
        }
            $('input[name="ndaytype"]:checked').next('span').addClass('checked');
        localStorage.setItem('obsdl_jikantaiFlag', JSON.stringify(jikantaiFlag));
        localStorage.setItem('obsdl_jikantaiList', JSON.stringify(jikantaiList));
        var nOf = getNum();
        getErr(nOf[0], nOf[1], nOf[2], nOf[3]);
        viewSelectedPeriod();
        
    });
    
    //選択時間帯を取得
    $('body').on('change', '.selectpr.jikantaiFlag select', function() {
        var inih, endh;
        if(jikantaiList.length == 0){
            inih=1;endh=24;
        }else{
//            inih=jikantaiList[0];endh=jikantaiList[1];
            inih = $('.selectpr.jikantaiFlag select[name="inih"]').val() ?? jikantaiList[0];
            endh = $('.selectpr.jikantaiFlag select[name="endh"]').val() ?? jikantaiList[1];
            if(inih < 1 || inih >24){inih=1};
            if(endh < 1 || endh >24){endh=24};
        }
        
        jikantaiList = [inih, endh];
        localStorage.setItem('obsdl_jikantaiList', JSON.stringify(jikantaiList));
        var nOf = getNum();
        getErr(nOf[0], nOf[1], nOf[2], nOf[3]);
        viewSelectedPeriod();
    });
    
    //
    //オプション関連
    //
    $('body').on('change', '#comprOption input , #comprOption select', function() {
        var nval = $(this).val();
        if (nval < 1) {
            nval = 1;
        } else if (nval > 30) {
            nval = 30;
        }
        if ($(this).attr('type') == 'number') {
            $('#comprOption input[type=number]').each(function() {
                $(this).val(nval);
            });
        }
        if ($(this).get(0).tagName == "SELECT") {
            $('#comprOption select').each(function() {
                $(this).val(nval);
            });
        }
        addOptionList();
        viewSelectedOption();
        var nOf = getNum();
        getErr(nOf[0], nOf[1], nOf[2], nOf[3]);
    });
    function getOptxt(str, nn) {
        const optionTexts = {
            op1: "平年値",
            op2: "平年値との差",
            op3: `${nn}年平均値`,
            op4: `${nn}年平均値との差(比)`
        };
        return optionTexts[str] || "";
    }

    function addOptionList() {
        optionNumList.length = 0;
        $('#comprOption input').next('span').removeClass('checked');
        $('#comprOption input:checkbox:checked').each(function() {
            $(this).next('span').addClass('checked');
            var thv = $(this).val();
            val = (thv == 'op3' || thv == 'op4') ? $(this).next('span').children('input.inumber,select.inumber').val() : 0;
            optionNumList.push([$(this).val(), val]);
        });
        localStorage.setItem('obsdl_optionNumList', JSON.stringify(optionNumList));
    }

    function checkSelectedOption() {
        for (i = 0; i < optionNumList.length; i++) {
            val = optionNumList[i][0];
            $(`#comprOption input:checkbox[value="${val}"]`).prop('checked', true).next('span').addClass('checked');
            if (val == 'op3' || val == 'op4') {
                ival = optionNumList[i][1];
                $('#comprOption input[type=number], #comprOption select').each(function() {
                    $(this).attr('value', ival);
                });
                $('#comprOption select').each(function() {
                    $(this).val(ival);
                });
            }
        }
    }

    function viewSelectedOption() {
        var str = '';
        for (i = 0; i < optionNumList.length; i++) {
            optxt = getOptxt(optionNumList[i][0], optionNumList[i][1]);
            str += `<div class="clearfix"><div class="selectedElopText">*${optxt}(すべての項目)</div></div>`;
            if (i == 1 && optionNumList.length > 2) {
                str += '</div><div class="clearfix">';
            }
        }
        $('#selectedElopList').html(str);
    }


    function viewSelectedViewOption() {
        var str = "";
        str = (rmkFlag == 1) ? "利用上注意が必要なデータを表示させる<br />" 
                             : "利用上注意が必要なデータを表示させない<br />";
        str += (disconnectFlag == 1) ? "観測環境などの変化以前のデータを表示させる<br />" 
                                     : "観測環境などの変化以前のデータを表示させない<br />";
        str += (csvFlag == 1) ? "ダウンロードデータはすべて数値で格納" 
                              : "ダウンロードデータに記号を含める";
        str += (kijiFlag == 1) ? "<br />発生時刻を表示" : "";
        // str += (huukouFlag == 1) ? "<br>風向を表示" : "";
        str += (youbiFlag == 1) ? "<br />曜日を表示（日別値）" : "";
        str += (fukenFlag == 1) ? "<br />ダウンロードデータに都道府県名を格納" : "";
        $('#selectedViewOption').html(str);
        return str;
    }


    $('body').on('change', 'input[name="rmkFlag"]',        (event) => { handleFlagOnChange('rmkFlag',        event);} );
    $('body').on('change', 'input[name="disconnectFlag"]', (event) => { handleFlagOnChange('disconnectFlag', event);} );
    $('body').on('change', 'input[name="csvFlag"]',        (event) => { handleFlagOnChange('csvFlag',        event); handleCsvFlagAdditionalChange(event); } );
    $('body').on('change', 'input[name="ymdLiteral"]',     (event) => { handleFlagOnChange('ymdLiteral',     event);} );

    /**
     * @description 表示オプションをの選択状況を切り替える
     * @function
     * @param {string} flgName オプション名
     * @param event
     */
    function handleFlagOnChange(flgName, event) {
        $(`input[name="${flgName}"]`).next('span').removeClass('checked');
        $(this).next('span').addClass('checked');
        window[flgName] = $(`input[name="${flgName}"]:checked`).val();
        localStorage.setItem(`obsdl_${flgName}`, JSON.stringify(window[flgName]));
        viewSelectedViewOption();
    };

    function handleCsvFlagAdditionalChange(event) {
        if (csvFlag == "1") {
            $('input[name="ymdLiteral"]').prop('disabled', false).parent('p').removeClass('unselectedkikan');
            $('input[name="ymdLiteral"]:checked').next('span').addClass('checked');
        } else {
            $('input[name="ymdLiteral"]').prop('disabled', true).next('span').removeClass('checked').parent('p').addClass('unselectedkikan');
        }
    };

    $('body').on('change', 'input[name="kijiFlag"]',  (event) => { handleFlagByCheck('kijiFlag',  event);} );
    $('body').on('change', 'input[name="youbiFlag"]', (event) => { handleFlagByCheck('youbiFlag', event);} );
    $('body').on('change', 'input[name="fukenFlag"]', (event) => { handleFlagByCheck('fukenFlag', event);} );

    /**
     * @description 表示オプションの選択・解除を設定する
     * @function
     * @param {string} flgName オプション名
     * @param event
     */
    function handleFlagByCheck(flgName, event) {
        if ($(`input[name='${flgName}']`).prop('checked')) {
            window[flgName] = 1;
            $(this).next('span').addClass('checked');
        } else {
            window[flgName] = 0;
            $(this).next('span').removeClass('checked');
        }
        localStorage.setItem(`obsdl_${flgName}`, window[flgName]);
        viewSelectedViewOption();

    };

    //データを表示
    var from = 'top';
    $('body').on('click', '#loadTable', function() {
        from = 'top';
        location.hash = "!table";
        // loadTable(1);
    });
    //分割した表の別ページ;pnでページ数指定
    $('body').on('click', '.reloadTable', function() {
        from = 'table';
        var pn = $(this).children('input').val();
        loadTable(pn);
    });
    function loadTable(pn) {
        const $wait = $("#wait");
        openDialog($wait);

        const errorMsg = getErrMseg();
        if (errorMsg) {
            closeDialog($wait);
            alert(errorMsg);
            location.hash = "";
            return;
        }

        stationNumList = Object.values(stationList).map(item => item[1]);
        elementNumList = Object.values(elementList).map(item => [item[1], item[2]]);

        ajobj = $.ajax({
            type: 'post',
            url: rooturl + 'show/table',
            dataType: 'html',
            data: {
                stationNumList: JSON.stringify(stationNumList),
                aggrgPeriod: aggrgPeriod,
                elementNumList: JSON.stringify(elementNumList),
                interAnnualType: interAnnualType,
                ymdList: JSON.stringify(ymdList),
                optionNumList: JSON.stringify(optionNumList),
                downloadFlag: false,
                selectedPageNum: pn,
                rmkFlag: rmkFlag,
                disconnectFlag: disconnectFlag,
                kijiFlag: kijiFlag,
                //huukouFlag: huukouFlag,
                youbiFlag: youbiFlag,
                fukenFlag: fukenFlag,
                jikantaiFlag: jikantaiFlag,
                jikantaiList: JSON.stringify(jikantaiList),
            },
            beforeSend: function(xhr) {
                $('input[name="calcelajax"]').on('click', function() {
                    closeDialog($wait);
                    xhr.abort();
                    if (from === 'top') location.hash = "";
                });
            },
            success: function(data) {
                $('#top_content').hide();
                $('#table_content').show();

                if (location.hash !== "#!table") {
                    location.hash = "!table";
                }
                try {
                        // Parse JSON data from server (generated by Shape.php)
                        var jsondata = JSON.parse(data);

                        // Determine frozen column index (for day of week display)
                        var frozencl = (youbiFlag == 1 && aggrgPeriod == 1) ? 1 : 0;

                        // Extract dimensions and column definitions
                        var width = jsondata['width'];
                        var height = jsondata['height'];
                        var columns = jsondata['header'];
                        var gridData = jsondata['data'];

                        // Set container dimensions
                        $('#data1').width(width + "px").height(height + "px");

                        /**
                         * SlickGrid 5.18.0 Options
                         * Enhanced with performance and UX improvements
                         */
                        var options = {
                            // Navigation & Interaction
                            enableCellNavigation: true,      // Allow keyboard navigation
                            enableColumnReorder: false,      // Disable column reordering

                            // Frozen Columns (for fixed date column)
                            frozenColumn: frozencl,          // Freeze first column(s)
                            frozenBottom: false,             // Don't freeze bottom rows

                            // Row & Column Sizing
                            rowHeight: 25,                   // Explicit row height (matches PHP calculation)
                            headerRowHeight: 80,             // Header height (matches PHP: 80px)

                            // Performance Optimizations (SlickGrid 5.18.0)
                            enableAsyncPostRender: false,    // Disable async rendering for simpler data
                            explicitInitialization: false,   // Initialize immediately

                            // Editing & Selection
                            editable: false,                 // Read-only grid
                            autoEdit: false,                 // Don't auto-enter edit mode

                            // Visual & UX
                            showHeaderRow: false,            // No filter row needed
                            fullWidthRows: false,            // Standard row width
                            forceFitColumns: false,          // Allow horizontal scroll

                            // Sorting
                            multiColumnSort: false,          // Disable multi-column sort
                            sortable: false,                 // Data is pre-sorted chronologically

                            // Cell Copy
                            enableCellNavigation: true,
                            enableTextSelectionOnCells: true,
                            enableCellCopyManager: true
                        };

                        // Enable auto-height for smaller grids
                        if (parseInt(height) < 700) {
                            options.autoHeight = true;
                        }

                        columns.forEach(function(col) {
                            if (col.id !== 'period' && col.id !== 'youbi') {
                                col.formatter = function(row, cell, value, columnDef, dataContext) {
                                    var classField = columnDef.field + '_class';
                                    if (dataContext[classField] === 'setsudan') {
                                        // セルにクラスを追加するためのマーカーを返す
                                        return '<div class="setsudan">' + value + '</div>';
                                    }
                                    return value;
                                };
                            }
                        });


                        /**
                         * Initialize SlickGrid 5.18.0
                         * Creates the grid with enhanced options and data
                         */
                        var grid = new Slick.Grid("#data1", gridData, columns, options);

                        // Apply custom CSS for header styling (80px height)
                        $(".slick-header-column").css("height", "80px");
                        $(".slick-header-columns").css("height", "80px");

                        // Resize grid to fit container
                        grid.resizeCanvas();

                        // Store grid instance globally for potential future use
                        window.slickGrid = grid;

                } catch (e) {
                        // Error handling: Display raw data if grid creation fails
                        console.error('SlickGrid initialization failed:', e);
                        $('#csvdl,#loadTop').css('display', 'none');
                        $('#data1').html(data);
                }
            },
            error: function(_xhr, textStatus) {
                if (textStatus !== "abort") {
                    closeDialog($wait);
                    alert("読み込めませんでした");
                }
                if (from === 'top') location.hash = "";
            }
        }).then(() => closeDialog($wait));
    }


    function loadTop() {
        $('#top_content').css('display', 'block');
        location.hash = '';
        $('#table_content').css('display', 'none');
    }


    function getNum() {
        var nOfSt = 0;
        if (Object.keys) {
            nOfSt = Object.keys(stationList).length;
        } else {
            for (prop in stationList) {
                nOfSt++;
            }
        }
        var nOfEl = (elementList && elementList.length) ? elementList.length : 0;
        var opnum = (optionNumList && optionNumList.length) ? optionNumList.length : 0;
        var opkey = 0;

        // additional weight for options
        const weights = { op1: 1, op2: 1, op3: 2, op4: 2 };
        let nOfOp = 1; // obsの分
        let opyear = 1;
        for (const opt of optionNumList) {
            nOfOp += weights[opt[0]] ?? 0;
            if (opt[0] === 'op3' || opt[0] === 'op4') {
                opyear = 1 + opt[1] / 30;
            }
        }
        nOfOp *= opyear;

        var nOfPr = countPrNum(aggrgPeriod,interAnnualType,ymdList,jikantaiList);
        return [nOfSt, nOfEl, nOfPr, nOfOp];
    }


    function getErr(nOfSt, nOfEl, nOfPr, nOfOp) {
        if (nOfSt == 0) nOfSt = 1;
        if (nOfEl == 0) nOfEl = 1;

        var str = "";
        var weight = 1;
        if (aggrgPeriod.slice(0, 1) == 8) { // N日平均
            weight = 1.5;
        }
        per = nOfSt * nOfEl * nOfPr * nOfOp * weight / seigen;
        if (per > 1) {
            perc = 1;
            num = per * 100;

            var keta = (num < 1000) ? 3 : (num < 10000) ? 4 : 5;
            str = num.toPrecision(keta) + "%";
            $('#percent').html(str);
        } else {
            perc = per;
            $('#percent').html(null);
        }
        $("#gauge1").width(100 * perc + "%");
        if (per > 1) {
            str = "地点、データ項目、期間のいずれかを減らしてください";
            $('#errMsgArea').html(str).addClass('alert');
            $('#gauge1').addClass('alert');
            return true;
        } else {
            str = "";
            $('#errMsgArea').html(str).removeClass('alert');
            $('#gauge1').removeClass('alert');
            return false;
        }
        return;
    }

    function getErrMseg() {
        var str = "";
        var errMseg = [];
        if ($.isEmptyObject(stationList)) {
            errMseg.push("地点が選択されていません");
        }
        if (!(elementList && elementList.length)) {
            errMseg.push("項目が選択されていません");
        }
        var nOf = getNum();
        if (getErr(nOf[0], nOf[1], nOf[2], nOf[3])) {
            errMseg.push("選択要素が多すぎます。地点、データ、期間のいずれかを減らしてください");
        }
        if (errMseg.length > 0) {
            for (i = 0; i < errMseg.length; i++) {
                str = str + errMseg[i] + '\n';
            }
            return str;
        } else {
            return false;
        }
    }


    /**
     * @description ダウンロード量のうち、期間の重みを計算する
     * @param aggrgPeriod
     * @param interAnnualType
     * @param ymdList
     * @param jikantaiList
     * @return 期間の重み
     */
    function countPrNum(aggrgPeriod, interAnnualType, ymdList, jikantaiList) {
        const aggrgType = parseInt(aggrgPeriod[0]);
        const [startYear, endYear, startMonth, endMonth, startDay, endDay] = ymdList.map(Number);
        const [startHour, endHour] = jikantaiList.map(Number);
        
        const MS_PER_DAY = 86400000;

        // 日付のオーバーフロー（例：非うるう年の2/29→3/1）を月末日に丸めるヘルパー
        const safeDate = (y, m, d) => {
            const dt = new Date(y, m - 1, d);
            return dt.getMonth() !== m - 1 ? new Date(y, m, 0) : dt;
        };

        // 日数計算のヘルパー
        const daysBetween = (y1, m1, d1, y2, m2, d2) =>
            Math.abs(safeDate(y2, m2, d2) - safeDate(y1, m1, d1)) / MS_PER_DAY + 1;
        
        // 時間帯補正計算
        const calcHourFactor = () => {
            if (jikantaiFlag != 1) return 1;
            const hoursInRange = startHour <= endHour 
                ? endHour - startHour + 1 
                : 24 - (startHour - endHour) + 1;
            return (24 + hoursInRange) / 48;
        };
        
        let diff;
        
        if (interAnnualType == 1) {
            if ([1, 8, 9].includes(aggrgType)) {
                diff = daysBetween(startYear, startMonth, startDay, endYear, endMonth, endDay);
                
                if (aggrgType === 8 && aggrgPeriod[1] === '1') {
                    diff /= parseInt(aggrgPeriod.slice(2));
                } else if (aggrgType === 9) {
                    diff *= 24 * calcHourFactor();
                }
            } else if ([2, 4].includes(aggrgType)) {
                const submonFactor = aggrgType === 2 ? 6 : 3;
                diff = Math.abs((endYear - startYear) * 12 * submonFactor + 
                            (endMonth - startMonth) * submonFactor + 
                            (endDay - startDay)) + 1;
            } else if ([5, 6].includes(aggrgType)) {
                diff = Math.abs(endYear * 12 + endMonth - startYear * 12 - startMonth) + 1;
            }
        } else {
            if ([1, 8, 9].includes(aggrgType)) {
                let dt1 = safeDate(startYear, endMonth, endDay);
                const dt2 = safeDate(startYear, startMonth, startDay);

                if (dt1 < dt2) {
                    dt1 = safeDate(startYear + 1, endMonth, endDay);
                }
                
                const diffDay = Math.abs(dt1 - dt2) / MS_PER_DAY + 1;
                const diffYear = Math.abs(endYear - startYear) + 1;
                diff = diffYear * diffDay;
                
                if (aggrgType === 8 && aggrgPeriod[1] === '1') {
                    diff /= parseInt(aggrgPeriod.slice(2));
                } else if (aggrgType === 9) {
                    diff *= 24 * calcHourFactor();
                }
            } else if ([2, 4].includes(aggrgType)) {
                const submonFactor = aggrgType === 2 ? 6 : 3;
                const yearDiff = Math.abs(startYear - endYear) + 1;
                
                const monthDayDiff = startMonth < endMonth || 
                                    (startMonth === endMonth && startDay <= endDay)
                    ? Math.abs((endMonth - startMonth) * submonFactor + (endDay - startDay)) + 1
                    : Math.abs(12 * submonFactor - ((startMonth - endMonth) * submonFactor + (startDay - endDay))) + 1;
                
                diff = yearDiff * monthDayDiff;
            } else if ([5, 6].includes(aggrgType)) {
                const yearDiff = Math.abs(startYear - endYear) + 1;
                const monthDiff = startMonth <= endMonth 
                    ? Math.abs(startMonth - endMonth) + 1
                    : Math.abs(12 - startMonth + endMonth) + 1;
                diff = yearDiff * monthDiff;
            }
        }
        
        return Math.abs(Math.floor(diff));
    }

    function insertymd() {
        const aggrgType = parseInt(aggrgPeriod[0]);
        var iniy, endy, inim, endm, inid, endd;
        var inimName, inidName, enddName;
        var clsName = ".interAnnualType" + interAnnualType;
        inimName = "inim";
        inidName = "inid";
        iniy = $(clsName + ' select[name="iniy"]').val();
        endy = $(clsName + ' select[name="endy"]').val();

        inim = $(clsName + ' select[name="' + inimName + '"]').val();
        endm = $(clsName + ' select[name="endm"]').val();

        if ([1, 2, 4, 8, 9].includes(aggrgType)) {
            inid = $(clsName + ' select[name="' + inidName + '"]').val();
            endd = $(clsName + ' select[name="endd"]').val();
        } else {
            inid = String(ymdList[4]);
            endd = String(ymdList[5]);
        }
        ymdList = [iniy, endy, inim, endm, inid, endd];
        localStorage.setItem('obsdl_ymdList', JSON.stringify(ymdList));
    }


    function setJikantai() {
        var inih, endh;
        if(jikantaiList.length == 0){
            inih=1;endh=24;
        }else{
            inih=jikantaiList[0];endh=jikantaiList[1];
        }
        if(inih < 1 || inih >24){inih=1};
        if(endh < 1 || endh >24){endh=24};
        $('.selectpr.jikantaiFlag select[name="inih"]').val(inih);
        $('.selectpr.jikantaiFlag select[name="endh"]').val(endh);

        if (jikantaiFlag == 1) {
            $('input[name="jikantaiFlag"]').prop("checked", true).next('span').addClass('checked');
            $('.selectpr.jikantaiFlag select').prop('disabled', false);
            $('.selectpr.jikantaiFlag span').removeClass('unselectedkikan');
            //console.log("jikan1");
        } else {
            $('input[name="jikantaiFlag"]').prop("checked", false).next('span').removeClass('checked');
            $('.selectpr.jikantaiFlag select').prop('disabled', true);
            $('.selectpr.jikantaiFlag span').addClass('unselectedkikan');
            //console.log("jikan0");
        }
        jikantaiList = [inih, endh];
        localStorage.setItem('obsdl_jikantaiList', JSON.stringify(jikantaiList));
        localStorage.setItem('obsdl_jikantaiFlag', JSON.stringify(jikantaiFlag));
        viewSelectedPeriod();
    }

    function calcDayValue(day, aggrgType) {
        if (aggrgType === 2) { // 暦日半旬
            return day > 25 ? 6 : Math.ceil(day / 5);
        } else if (aggrgType === 4) { // 旬
            return day > 20 ? 3 : day > 10 ? 2 : 1;
        } else {
            return day;
        }
    }

    function changePeriod(str) {
        const now = new Date();
        const yd = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);

        // 期間の調整
        const periods = { "1y": [1, 0], "1m": [0, 1], "10y": [10, 0] };
        const [years, months] = periods[str] || [0, 0];
        const yd1 = new Date(yd.getFullYear() - years, yd.getMonth() - months, yd.getDate());

        const aggrgType = parseInt(aggrgPeriod[0]);
        ymdList[0] = yd1.getFullYear();
        ymdList[1] = yd.getFullYear();
        ymdList[2] = yd1.getMonth() + 1;
        ymdList[3] = yd.getMonth() + 1;
        ymdList[4] = calcDayValue(yd1.getDate(), aggrgType);
        ymdList[5] = calcDayValue(yd.getDate(), aggrgType);

        localStorage.setItem('obsdl_ymdList', JSON.stringify(ymdList));
        changeInputPeriod();
    }

    $('body').on('click', '#chpr1y,#chpr1m,#chpr10y', function() {
        $changeType = ($(this).attr('id') === "chpr1y") ? "1y" : ($(this).attr('id') === "chpr1m") ? "1m" : "10y";
        changePeriod($changeType);
    });
    function viewSelectedPeriod() {
        var strs = getYmdStr();
        var str = "";
        if (interAnnualType == 1) {
            str += `${strs[0]}${strs[2]}から<br />${strs[1]}${strs[3]}まで の${strs[4]}を表示`;
        } else {
            str += `${strs[2]}から${strs[3]}までの${strs[4]}を<br>${strs[0]}から${strs[1]}まで表示`;
        }

        if (aggrgPeriod == 9 && jikantaiFlag == 1){
            str += "<br />"+jikantaiList[0] + "時から" + jikantaiList[1] + "時までの時間帯を表示";
        }

        $('#selectedPeriod').html(str);
    }

    function getYmdStr() {
        const [startYear, endYear, startMonth, endMonth, startDay, endDay] = ymdList;
        const aggrgType = parseInt(aggrgPeriod[0]);

        // 各集計タイプの設定
        const formats = {
            1: {
                period: (m, d) => `${m}月${d}日`,
                label: "日別値"
            },
            2: {
                period: (m, d) => `${m}月第${d}半旬`,
                label: "半旬別値"
            },
            4: {
                period: (m, d) => `${m}月${day10[d]}`,
                label: "旬別値"
            },
            5: {
                period: (m) => `${m}月`,
                label: "月別値"
            },
            6: {
                period: (m) => `${m}月`,
                label: "3か月別値"
            },
            8: {
                period: (m, d) => `${m}月${d}日`,
                label: `前${aggrgPeriod.slice(2)}日別値`
            },
            9: {
                period: (m, d) => `${m}月${d}日`,
                label: "時別値"
            }
        };

        const config = formats[aggrgType];
        if (!config) return null;

        return [
            `${startYear}年`,
            `${endYear}年`,
            config.period(startMonth, startDay),
            config.period(endMonth, endDay),
            config.label
        ];
    }

    var createForm = function(form, name, element) {
        var input = document.createElement('input');
        setform(input, 'hidden', name, element);
        form.appendChild(input);
    };

    $('body').on('click', '#csvdl', function() {
        // Wait dialogを表示
        openDialog("#wait");

        var str = getErrMseg();
        if (str) {
            closeDialog("#wait");
            alert(str);
            location.hash = "";
        } else {
            // ダウンロード完了Cookieを削除
            document.cookie = 'downloadComplete=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';

            var stationNumList = [];
            var elementNumList = [];
            $.each(stationList, function(key) {
                stationNumList.push($(this)[1]);
            });
            $.each(elementList, function() {
                elementNumList.push([$(this)[1], $(this)[2]]);
            });
            var form = document.createElement('form');
            document.body.appendChild(form);
            createForm(form, 'stationNumList',  JSON.stringify(stationNumList));
            createForm(form, 'aggrgPeriod',     aggrgPeriod);
            createForm(form, 'elementNumList',  JSON.stringify(elementNumList));
            createForm(form, 'interAnnualType', interAnnualType);
            createForm(form, 'ymdList',         JSON.stringify(ymdList));
            createForm(form, 'optionNumList',   JSON.stringify(optionNumList));
            createForm(form, 'downloadFlag',    true);
            createForm(form, 'rmkFlag',         rmkFlag);
            createForm(form, 'disconnectFlag',  disconnectFlag);
            createForm(form, 'youbiFlag',       youbiFlag);
            createForm(form, 'fukenFlag',       fukenFlag);
            createForm(form, 'kijiFlag',        kijiFlag);
            //createForm(form, 'huukouFlag',      huukouFlag);
            createForm(form, 'csvFlag',         csvFlag);
            createForm(form, 'jikantaiFlag',    jikantaiFlag);
            createForm(form, 'jikantaiList',    JSON.stringify(jikantaiList));//配列はJSON.stringifyで
            createForm(form, 'ymdLiteral',      ymdLiteral);
            form.setAttribute('method', 'post');
            form.setAttribute('action', 'show/table');
            form.submit();

            // Cookieをポーリングしてダウンロード完了を検知
            var downloadCheckInterval = setInterval(function() {
                if (document.cookie.indexOf('downloadComplete') !== -1) {
                    clearInterval(downloadCheckInterval);
                    closeDialog("#wait");
                    // Cookieを削除
                    document.cookie = 'downloadComplete=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
                }
            }, 100); // 100msごとにチェック

            // 安全のため2分後にタイムアウト
            setTimeout(function() {
                clearInterval(downloadCheckInterval);
                closeDialog("#wait");
            }, 120000);
        }
    });

});

// non-DOM functions

function getAggrgPeriod(aggrgPeriod) {
    const aggrgType = parseInt(aggrgPeriod[0]);
    return (aggrgType !== 8) ? aggrgChar[aggrgType] : aggrgPeriod.slice(2) + '日間';
}

function calcAcrossYearMaxYear(aggrgNum, endMonth, endDay, latestday) {
    var maxy, latestYear, latestMonth, latestDay;
    latestYear  = latestday.getFullYear();
    latestMonth = latestday.getMonth();
    latestDay   = latestday.getDate();
    if (endMonth == latestMonth + 1) {
        if (aggrgNum === 2) { //暦日半旬 endDay = 1, 2, .., 6
            maxy = (latestDay >= 5 * (endDay - 1)) ? latestYear : latestYear - 1;
        } else if (aggrgNum === 4) { //旬 endDay = 1, 2, 3
            maxy = (latestDay >= 10 * (endDay - 1)) ? latestYear : latestYear - 1;
        } else if ([1, 8, 9].includes(aggrgNum)){
            maxy = (latestDay >= endDay) ? latestYear : latestYear - 1;
        } else {
            maxy = latestYear;
        }
    } else if (endMonth > latestMonth + 1) {
        maxy= latestYear - 1;
    } else {
        maxy = latestYear;
    }

    return maxy;
}

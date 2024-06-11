using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Data;
using System.Windows.Documents;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Navigation;
using System.Windows.Shapes;

namespace DrawSomeDots
{
    /// <summary>
    /// Interaction logic for MainWindow.xaml
    /// </summary>
    public partial class MainWindow : Window
    {
        public MainWindow()
        {
            InitializeComponent();
        }

        private void cmdGo_Click(object sender, RoutedEventArgs e)
        {
            string s = txtNum.Text;
            TextBlock T = new TextBlock();
            cPaint.Background = Brushes.Magenta;
            T.Text = s;
            T.Foreground = Brushes.White;
            Canvas.SetLeft(T, 0);
            Canvas.SetTop(T, 0);
            T.VerticalAlignment = System.Windows.VerticalAlignment.Top;
            T.FontSize = cPaint.ActualHeight * .9;
            cPaint.Children.Add(T);
            DrawDots(int.Parse(s));

            AdornerLayer al = AdornerLayer.GetAdornerLayer(T);
            al.Add(new AdornWithDots(100,T));

        }
        Random _r = null;
        Random r
        {
            get
            {
                if(_r == null)
                {
                    _r = new System.Random(59349);
                }
                return _r;
            }

        }
        private void DrawDots(int num)
        {
            for( int i =0 ;i  < num;  i++)
            {
                Ellipse e =  CreatePoint();
                if(ISvalid (e ))
                    cPaint.Children.Add(e);
            }
        }

        private bool ISvalid(Ellipse e)
        {
            return true;
        }

        private Ellipse CreatePoint()
        {
            const int MaxSize = 5;
            int size = r.Next(1,5);
            Ellipse e = new Ellipse();
            e.Width= size;
            e.Height = size;
            Brush b = CreateRandomColor();
            return e;

        }

        private Brush CreateRandomColor()
        {
            Color C = new Color();
            C.B = (byte)r.Next(0, 255);
            C.G = (byte)r.Next(0, 255);
            C.R = (byte)r.Next(0, 255);
            return new SolidColorBrush(C);
        }
    }
}
